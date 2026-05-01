/**
 * Hourly cron that scans cross-firm abuse signals and emails Onsective
 * ops when any tenant crosses a threshold. Dedupes alerts via Redis —
 * once we email about (signal, tenantId), we don't re-alert until 24h
 * later, so a noisy firm doesn't bury the inbox.
 *
 * Thresholds match the /admin/abuse page UI so the email links right back.
 */
import { prisma } from '@onsecboad/db';
import { sendEmail } from '@onsecboad/email';
import { loadEnv } from '@onsecboad/config';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const env = loadEnv();

const THRESHOLDS = {
  failedLogins: 50, // 24h
  smsVolume: 5000, // 7d
  aiCostCents: 100_000, // $1000 in 7d
  suppressionGrowth: 100, // 7d
};

const DEDUP_TTL = 24 * 60 * 60; // 24h

type Alert = {
  tenantId: string;
  tenantName: string;
  signal: 'failedLogins' | 'smsVolume' | 'aiCost' | 'suppressionGrowth';
  value: number;
  threshold: number;
  unit: string;
};

export async function abuseAlertsTick(): Promise<{
  scanned: number;
  alerts: number;
  emailed: number;
  errors: number;
}> {
  const stats = { scanned: 0, alerts: 0, emailed: 0, errors: 0 };

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [failedLogins, smsVolume, aiCost, suppressionGrowth] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ['tenantId'],
      where: {
        createdAt: { gte: last24h },
        action: { contains: 'signIn.fail' },
        tenantId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.smsLog.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: last7d } },
      _count: { _all: true },
    }),
    prisma.aiUsage.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: last7d } },
      _sum: { costCents: true },
    }),
    prisma.suppressionEntry.groupBy({
      by: ['tenantId'],
      where: { addedAt: { gte: last7d } },
      _count: { _all: true },
    }),
  ]);

  // Prisma's _count return type widens awkwardly for groupBy results; the
  // groupBy variant types `_count` as `true | {...}`. We always pass an
  // object so the runtime shape is `{ _all: number }` — coerce explicitly.
  const cAll = (r: { _count?: unknown }): number =>
    (r._count as { _all?: number } | undefined)?._all ?? 0;

  const tenantIds = new Set<string>();
  failedLogins.forEach((r) => r.tenantId && tenantIds.add(r.tenantId));
  smsVolume.forEach((r) => tenantIds.add(r.tenantId));
  aiCost.forEach((r) => tenantIds.add(r.tenantId));
  suppressionGrowth.forEach((r) => tenantIds.add(r.tenantId));
  stats.scanned = tenantIds.size;

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: Array.from(tenantIds) } },
    select: { id: true, displayName: true, slug: true },
  });
  const nameOf = new Map(tenants.map((t) => [t.id, t.displayName]));

  const alerts: Alert[] = [];
  for (const r of failedLogins) {
    if (r.tenantId && cAll(r) > THRESHOLDS.failedLogins) {
      alerts.push({
        tenantId: r.tenantId,
        tenantName: nameOf.get(r.tenantId) ?? r.tenantId,
        signal: 'failedLogins',
        value: cAll(r),
        threshold: THRESHOLDS.failedLogins,
        unit: 'failed logins in 24h',
      });
    }
  }
  for (const r of smsVolume) {
    if (cAll(r) > THRESHOLDS.smsVolume) {
      alerts.push({
        tenantId: r.tenantId,
        tenantName: nameOf.get(r.tenantId) ?? r.tenantId,
        signal: 'smsVolume',
        value: cAll(r),
        threshold: THRESHOLDS.smsVolume,
        unit: 'SMS in 7d',
      });
    }
  }
  for (const r of aiCost) {
    const cost = Number(r._sum.costCents ?? 0);
    if (cost > THRESHOLDS.aiCostCents) {
      alerts.push({
        tenantId: r.tenantId,
        tenantName: nameOf.get(r.tenantId) ?? r.tenantId,
        signal: 'aiCost',
        value: cost,
        threshold: THRESHOLDS.aiCostCents,
        unit: 'cents AI spend in 7d',
      });
    }
  }
  for (const r of suppressionGrowth) {
    if (cAll(r) > THRESHOLDS.suppressionGrowth) {
      alerts.push({
        tenantId: r.tenantId,
        tenantName: nameOf.get(r.tenantId) ?? r.tenantId,
        signal: 'suppressionGrowth',
        value: cAll(r),
        threshold: THRESHOLDS.suppressionGrowth,
        unit: 'suppressions in 7d',
      });
    }
  }
  stats.alerts = alerts.length;

  if (alerts.length === 0) return stats;

  const onsecAddress = env.ONSEC_ALERT_EMAIL ?? env.SMTP_USER;
  if (!onsecAddress) {
    logger.warn('abuse alerts: no ONSEC_ALERT_EMAIL or SMTP_USER configured — skipping email');
    return stats;
  }

  for (const a of alerts) {
    const dedupKey = `alert:abuse:${a.signal}:${a.tenantId}`;
    const already = await redis.get(dedupKey);
    if (already) continue;

    const subject = `[OnsecBoad abuse alert] ${a.tenantName} — ${a.signal}`;
    const body = `Firm "${a.tenantName}" (${a.tenantId}) crossed the ${a.signal} threshold:

Value:     ${a.value.toLocaleString()} ${a.unit}
Threshold: ${a.threshold.toLocaleString()} ${a.unit}

Investigate at: ${env.APP_URL.replace(/\/$/, '')}/p/firms/${a.tenantId}
Cross-firm view: ${env.APP_URL.replace(/\/$/, '')}/admin/abuse

This alert is suppressed for the next 24 hours for this firm + signal.
`;
    try {
      const result = await sendEmail({
        to: onsecAddress,
        subject,
        text: body,
        html: `<pre style="font-family:Menlo,Monaco,monospace;font-size:13px;">${body
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</pre>`,
      });
      if (result.ok) {
        stats.emailed++;
        await redis.set(dedupKey, '1', 'EX', DEDUP_TTL);
      } else {
        stats.errors++;
        logger.warn(
          { signal: a.signal, tenantId: a.tenantId, error: result.error },
          'abuse alert send failed',
        );
      }
    } catch (e) {
      stats.errors++;
      logger.warn({ err: e, alert: a }, 'abuse alert send threw');
    }
  }

  return stats;
}
