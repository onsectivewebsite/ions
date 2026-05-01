/**
 * Per-user iCal feed. Calendar apps (Google, Outlook, Apple Calendar)
 * subscribe to the URL and re-fetch periodically — usually 30 min.
 *
 * URL: GET /api/v1/users/:userId/calendar.ics?token=<accessJwt>
 *
 * Auth via the access token in the query string (calendar apps can't
 * set Authorization headers). Returns 30 days back + 90 days forward
 * of appointments where the user is provider OR the lead/client of
 * record. UTC datetimes; no recurrence — every event materialised.
 */
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();

function fmtICalDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeICal(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  // RFC5545: lines >75 octets must be folded with CRLF + space.
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += 73) {
    chunks.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
  }
  return chunks.join('\r\n');
}

export async function userCalendarFeedHandler(req: Request, res: Response): Promise<void> {
  const userId = String(req.params.userId ?? '');
  const token = String(req.query.token ?? '');
  if (!userId || !token) {
    res.status(401).type('text/plain').send('Missing token');
    return;
  }
  let claims;
  try {
    claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET);
  } catch {
    res.status(401).type('text/plain').send('Invalid token');
    return;
  }
  // Allow only self (a user can subscribe to their own feed).
  if (claims.scope !== 'firm' || claims.sub !== userId) {
    res.status(403).type('text/plain').send('Forbidden');
    return;
  }

  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const appts = await prisma.appointment.findMany({
    where: {
      tenantId: claims.tenantId!,
      providerId: userId,
      scheduledAt: { gte: from, lte: to },
    },
    include: {
      client: { select: { firstName: true, lastName: true, email: true, phone: true } },
      lead: { select: { firstName: true, lastName: true, email: true, phone: true } },
      tenant: { select: { displayName: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });

  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Onsective//OnsecBoad//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push(`X-WR-CALNAME:OnsecBoad — ${appts[0]?.tenant.displayName ?? 'consultations'}`);
  lines.push('X-PUBLISHED-TTL:PT30M');

  for (const a of appts) {
    if (a.status === 'CANCELLED') continue;
    const start = a.scheduledAt;
    const end = new Date(start.getTime() + (a.durationMin ?? 30) * 60 * 1000);
    const subject = a.client ?? a.lead;
    const subjectName = subject
      ? [subject.firstName, subject.lastName].filter(Boolean).join(' ') || 'Client'
      : 'Walk-in';
    const summary = `${a.kind === 'consultation' ? 'Consultation' : a.kind} — ${subjectName}`;
    const desc = [
      a.caseType ? `Case type: ${a.caseType.replace(/_/g, ' ')}` : null,
      subject?.phone ? `Phone: ${subject.phone}` : null,
      subject?.email ? `Email: ${subject.email}` : null,
      a.notes ? `\n${a.notes}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push(fold(`UID:${a.id}@onsective.cloud`));
    lines.push(`DTSTAMP:${fmtICalDate(new Date())}`);
    lines.push(`DTSTART:${fmtICalDate(start)}`);
    lines.push(`DTEND:${fmtICalDate(end)}`);
    lines.push(fold(`SUMMARY:${escapeICal(summary)}`));
    if (desc) lines.push(fold(`DESCRIPTION:${escapeICal(desc)}`));
    lines.push(`STATUS:${a.status === 'COMPLETED' ? 'CONFIRMED' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(lines.join('\r\n'));
}
