/**
 * Pulls the next ~30 days of events from every active CalendarConnection
 * and upserts them as CalendarBusySlot rows. The booking flow checks
 * these to warn about double-booking. Read-only — we only fetch external
 * events, never write back here (that's pushAppointmentTo*).
 *
 * Token refresh is handled inside each provider lib.
 */
import { decryptString, encryptString } from '@onsecboad/auth';
import { prisma } from '@onsecboad/db';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';

const env = loadEnv();
const HORIZON_DAYS = 30;

type Slot = {
  externalEventId: string;
  summary: string | null;
  startsAt: Date;
  endsAt: Date;
};

async function fetchGoogleSlots(accessToken: string): Promise<Slot[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '250');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google list ${res.status}`);
  const data = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      transparency?: string;
    }[];
  };
  const out: Slot[] = [];
  for (const e of data.items ?? []) {
    if (e.transparency === 'transparent') continue; // free/show-as-free events
    const startStr = e.start?.dateTime ?? e.start?.date;
    const endStr = e.end?.dateTime ?? e.end?.date;
    if (!startStr || !endStr) continue;
    out.push({
      externalEventId: e.id,
      summary: e.summary ?? null,
      startsAt: new Date(startStr),
      endsAt: new Date(endStr),
    });
  }
  return out;
}

async function fetchOutlookSlots(accessToken: string): Promise<Slot[]> {
  const start = new Date().toISOString();
  const end = new Date(Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=250&$orderby=start/dateTime`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!res.ok) throw new Error(`Graph list ${res.status}`);
  const data = (await res.json()) as {
    value?: {
      id: string;
      subject?: string;
      start?: { dateTime: string; timeZone: string };
      end?: { dateTime: string; timeZone: string };
      showAs?: string;
    }[];
  };
  const out: Slot[] = [];
  for (const e of data.value ?? []) {
    if (e.showAs === 'free') continue;
    if (!e.start?.dateTime || !e.end?.dateTime) continue;
    out.push({
      externalEventId: e.id,
      summary: e.subject ?? null,
      startsAt: new Date(`${e.start.dateTime}Z`),
      endsAt: new Date(`${e.end.dateTime}Z`),
    });
  }
  return out;
}

async function refreshIfExpired(connectionId: string): Promise<string | null> {
  const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.status !== 'active') return null;
  const access = decryptString(conn.accessTokenEnc);
  if (conn.expiresAt.getTime() > Date.now() + 60_000) return access;
  if (!conn.refreshTokenEnc) return null;
  const refresh = decryptString(conn.refreshTokenEnc);
  try {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
    if (conn.provider === 'google') {
      body.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID ?? '');
      body.set('client_secret', env.GOOGLE_OAUTH_CLIENT_SECRET ?? '');
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!r.ok) return null;
      const d = (await r.json()) as { access_token: string; expires_in: number };
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptString(d.access_token),
          expiresAt: new Date(Date.now() + d.expires_in * 1000),
        },
      });
      return d.access_token;
    }
    if (conn.provider === 'outlook') {
      body.set('client_id', env.MS_OAUTH_CLIENT_ID ?? '');
      body.set('client_secret', env.MS_OAUTH_CLIENT_SECRET ?? '');
      body.set('scope', 'openid email offline_access Calendars.ReadWrite');
      const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!r.ok) return null;
      const d = (await r.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
      };
      await prisma.calendarConnection.update({
        where: { id: conn.id },
        data: {
          accessTokenEnc: encryptString(d.access_token),
          ...(d.refresh_token ? { refreshTokenEnc: encryptString(d.refresh_token) } : {}),
          expiresAt: new Date(Date.now() + d.expires_in * 1000),
        },
      });
      return d.access_token;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function calendarSyncTick(): Promise<{
  connections: number;
  slotsUpserted: number;
  errors: number;
}> {
  const stats = { connections: 0, slotsUpserted: 0, errors: 0 };
  const conns = await prisma.calendarConnection.findMany({
    where: { status: 'active' },
  });
  stats.connections = conns.length;

  for (const c of conns) {
    try {
      const token = await refreshIfExpired(c.id);
      if (!token) continue;
      const slots = c.provider === 'google'
        ? await fetchGoogleSlots(token)
        : c.provider === 'outlook'
          ? await fetchOutlookSlots(token)
          : [];

      // Wipe rows beyond the horizon (fetched > 1 hour ago + already
      // outside window) to avoid drift.
      await prisma.calendarBusySlot.deleteMany({
        where: {
          connectionId: c.id,
          OR: [
            { endsAt: { lt: new Date() } }, // past
            { fetchedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
          ],
        },
      });

      for (const s of slots) {
        await prisma.calendarBusySlot.upsert({
          where: {
            connectionId_externalEventId: {
              connectionId: c.id,
              externalEventId: s.externalEventId,
            },
          },
          create: { ...s, connectionId: c.id },
          update: {
            summary: s.summary,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            fetchedAt: new Date(),
          },
        });
        stats.slotsUpserted++;
      }
      await prisma.calendarConnection.update({
        where: { id: c.id },
        data: { lastSyncedAt: new Date(), lastError: null },
      });
    } catch (e) {
      stats.errors++;
      logger.warn({ err: e, connectionId: c.id }, 'calendar sync failed');
      await prisma.calendarConnection.update({
        where: { id: c.id },
        data: { lastError: e instanceof Error ? e.message.slice(0, 500) : 'unknown' },
      });
    }
  }
  return stats;
}
