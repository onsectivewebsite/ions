/**
 * Appointment reminder cron — emails the client (and firm-side
 * provider) before each consult.
 *
 * Two passes per tick:
 *   long  — for appointments 24h–25h out, send a "tomorrow" reminder
 *   short — for appointments 50min–70min out, send a "starting soon"
 *
 * Dedup is via Redis: alert:apt:<id>:<kind> with 24h TTL. If the cron
 * is busy / restarts, we never send the same kind twice.
 *
 * Schedule it every 5 minutes so the short window catches in time.
 */
import { prisma } from '@onsecboad/db';
import { buildAppointmentReminderEmail } from '@onsecboad/email';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import { tenantEmailBrand } from '../lib/email-brand.js';
import { sendTrackedEmail } from '../lib/track-email.js';

const DEDUP_TTL = 24 * 60 * 60;

type ApptRow = NonNullable<
  Awaited<ReturnType<typeof prisma.appointment.findFirst>>
> & {
  client: { firstName: string | null; lastName: string | null; email: string | null } | null;
  lead: { firstName: string | null; lastName: string | null; email: string | null } | null;
  provider: { name: string; email: string } | null;
  tenant: { displayName: string; branding: unknown; reminderConfig: unknown };
};

type TenantReminderConfig = {
  sendLong?: boolean;
  sendShort?: boolean;
  longHours?: number;
  shortMinutes?: number;
};

const DEFAULT_LONG_HOURS = 24;
const DEFAULT_SHORT_MINUTES = 60;
// Cron tick window — keep wide enough to absorb cron jitter / restarts.
const TICK_WINDOW_MS = 60 * 60 * 1000; // long: ±30 min around N hours
const SHORT_TICK_WINDOW_MS = 20 * 60 * 1000; // short: ±10 min

function tenantConfig(t: { reminderConfig?: unknown }): Required<TenantReminderConfig> {
  const c = (t.reminderConfig as TenantReminderConfig | null | undefined) ?? {};
  return {
    sendLong: c.sendLong ?? true,
    sendShort: c.sendShort ?? true,
    longHours: c.longHours ?? DEFAULT_LONG_HOURS,
    shortMinutes: c.shortMinutes ?? DEFAULT_SHORT_MINUTES,
  };
}

async function loadDue(kind: 'long' | 'short'): Promise<ApptRow[]> {
  const now = Date.now();
  // Use widest possible window across tenants — actual filtering by
  // each tenant's lead time happens in code below.
  const fromMs =
    kind === 'long' ? now + 22 * 60 * 60 * 1000 : now + 40 * 60 * 1000;
  const toMs =
    kind === 'long' ? now + 26 * 60 * 60 * 1000 : now + 80 * 60 * 1000;
  return prisma.appointment.findMany({
    where: {
      scheduledAt: { gte: new Date(fromMs), lt: new Date(toMs) },
      status: { in: ['SCHEDULED', 'CONFIRMED'] },
    },
    include: {
      client: { select: { firstName: true, lastName: true, email: true } },
      lead: { select: { firstName: true, lastName: true, email: true } },
      provider: { select: { name: true, email: true } },
      tenant: { select: { displayName: true, branding: true, reminderConfig: true } },
    },
  }) as unknown as Promise<ApptRow[]>;
}

function isInWindow(scheduledAt: Date, kind: 'long' | 'short', cfg: Required<TenantReminderConfig>): boolean {
  const ms = scheduledAt.getTime() - Date.now();
  if (kind === 'long') {
    if (!cfg.sendLong) return false;
    const target = cfg.longHours * 60 * 60 * 1000;
    return Math.abs(ms - target) < TICK_WINDOW_MS / 2;
  }
  if (!cfg.sendShort) return false;
  const target = cfg.shortMinutes * 60 * 1000;
  return Math.abs(ms - target) < SHORT_TICK_WINDOW_MS / 2;
}

async function sendOne(a: ApptRow, kind: 'long' | 'short'): Promise<boolean> {
  const recipient = a.client ?? a.lead;
  if (!recipient?.email) return false;
  const dedup = `alert:apt:${a.id}:${kind}`;
  const already = await redis.get(dedup);
  if (already) return false;
  const built = buildAppointmentReminderEmail({
    to: recipient.email,
    recipientName: [recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || 'there',
    firmName: a.tenant.displayName,
    kind,
    scheduledAt: a.scheduledAt,
    durationMin: a.durationMin ?? 30,
    caseType: a.caseType,
    providerName: a.provider?.name ?? null,
    brand: tenantEmailBrand(a.tenant),
  });
  const result = await sendTrackedEmail({
    ...built,
    tenantId: a.tenantId,
    templateKey: `appt-reminder-${kind}`,
    leadId: a.leadId ?? undefined,
  });
  if (result.ok) {
    await redis.set(dedup, '1', 'EX', DEDUP_TTL);
  } else {
    logger.warn(
      { appointmentId: a.id, kind, error: result.error },
      'appointment reminder send failed',
    );
  }
  return result.ok;
}

export async function appointmentRemindersTick(): Promise<{
  scanned: number;
  sent: number;
  errors: number;
}> {
  const stats = { scanned: 0, sent: 0, errors: 0 };
  for (const kind of ['long', 'short'] as const) {
    let rows: ApptRow[] = [];
    try {
      rows = await loadDue(kind);
    } catch (e) {
      stats.errors++;
      logger.warn({ err: e, kind }, 'reminders load failed');
      continue;
    }
    stats.scanned += rows.length;
    for (const a of rows) {
      try {
        const cfg = tenantConfig(a.tenant);
        if (!isInWindow(a.scheduledAt, kind, cfg)) continue;
        const sent = await sendOne(a, kind);
        if (sent) stats.sent++;
      } catch (e) {
        stats.errors++;
        logger.warn({ err: e, appointmentId: a.id, kind }, 'reminders send threw');
      }
    }
  }
  return stats;
}
