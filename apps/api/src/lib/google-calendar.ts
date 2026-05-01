/**
 * Minimal Google Calendar wrapper. No googleapis SDK — we just hit the
 * REST endpoints with fetch. Keeps the dep footprint small.
 *
 * OAuth 2.0 authorization code flow:
 *   1. /connect → redirect user to consent URL (state = signed userId)
 *   2. /callback → exchange code for tokens, store encrypted
 *   3. on appointment.create → push the event using accessToken;
 *      auto-refresh via refreshToken if expired.
 *
 * Token storage uses the existing column-encryption key
 * (ENCRYPTION_KEY_BASE64), shared with TOTP secrets etc.
 */
import { encryptString, decryptString } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';

const env = loadEnv();

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_EVENTS = (calId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export function googleConnectUrl(state: string): string | null {
  if (!env.GOOGLE_OAUTH_CLIENT_ID) return null;
  const redirect = `${env.API_URL.replace(/\/$/, '')}/api/v1/calendar/google/callback`;
  const u = new URL(GOOGLE_AUTH);
  u.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

type TokenResp = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

export async function exchangeGoogleCode(code: string): Promise<TokenResp> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('Google OAuth not configured');
  }
  const redirect = `${env.API_URL.replace(/\/$/, '')}/api/v1/calendar/google/callback`;
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return (await res.json()) as TokenResp;
}

async function refreshGoogleToken(refreshToken: string): Promise<TokenResp> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('Google OAuth not configured');
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  return (await res.json()) as TokenResp;
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  const data = (await res.json()) as { email?: string };
  return data.email ?? 'unknown@google';
}

async function getActiveAccessToken(connectionId: string): Promise<string> {
  const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.status !== 'active') throw new Error('connection not active');
  const accessToken = decryptString(conn.accessTokenEnc);
  // 60-second skew window.
  if (conn.expiresAt.getTime() > Date.now() + 60_000) {
    return accessToken;
  }
  if (!conn.refreshTokenEnc) throw new Error('access token expired and no refresh token');
  const refreshToken = decryptString(conn.refreshTokenEnc);
  const fresh = await refreshGoogleToken(refreshToken);
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptString(fresh.access_token),
      expiresAt: new Date(Date.now() + fresh.expires_in * 1000),
    },
  });
  return fresh.access_token;
}

export type AppointmentToSync = {
  appointmentId: string;
  summary: string;
  description?: string;
  startISO: string;
  endISO: string;
  attendees?: string[];
};

/** Update mirrored events on every connected calendar. Best-effort. */
export async function updateAppointmentOnGoogle(
  appointmentId: string,
  patch: Partial<AppointmentToSync>,
): Promise<void> {
  const links = await prisma.appointmentExternalEvent.findMany({
    where: { appointmentId, provider: 'google' },
    include: { connection: true },
  });
  for (const link of links) {
    if (link.connection.status !== 'active') continue;
    try {
      const token = await getActiveAccessToken(link.connectionId);
      const calId = link.connection.calendarId ?? 'primary';
      const body: Record<string, unknown> = {};
      if (patch.summary !== undefined) body.summary = patch.summary;
      if (patch.description !== undefined) body.description = patch.description;
      if (patch.startISO !== undefined) body.start = { dateTime: patch.startISO };
      if (patch.endISO !== undefined) body.end = { dateTime: patch.endISO };
      const res = await fetch(`${GOOGLE_EVENTS(calId)}/${encodeURIComponent(link.externalEventId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Google PATCH ${res.status}`);
    } catch (err) {
      logger.warn({ err, link }, 'google calendar update failed');
    }
  }
}

/** Delete mirrored events on every connected calendar. Best-effort. */
export async function deleteAppointmentOnGoogle(appointmentId: string): Promise<void> {
  const links = await prisma.appointmentExternalEvent.findMany({
    where: { appointmentId, provider: 'google' },
    include: { connection: true },
  });
  for (const link of links) {
    if (link.connection.status !== 'active') continue;
    try {
      const token = await getActiveAccessToken(link.connectionId);
      const calId = link.connection.calendarId ?? 'primary';
      const res = await fetch(
        `${GOOGLE_EVENTS(calId)}/${encodeURIComponent(link.externalEventId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status !== 204 && !res.ok) throw new Error(`Google DELETE ${res.status}`);
      await prisma.appointmentExternalEvent.delete({ where: { id: link.id } });
    } catch (err) {
      logger.warn({ err, link }, 'google calendar delete failed');
    }
  }
}

/**
 * Fire-and-forget push of one appointment to all of the user's active
 * Google Calendar connections. Errors are logged + recorded on the
 * connection row but never propagate — appointment.create must succeed
 * even if Google's down.
 */
export async function pushAppointmentToGoogle(
  userId: string,
  appt: AppointmentToSync,
): Promise<void> {
  const conns = await prisma.calendarConnection.findMany({
    where: { userId, provider: 'google', status: 'active' },
  });
  for (const c of conns) {
    try {
      const token = await getActiveAccessToken(c.id);
      const calId = c.calendarId ?? 'primary';
      const res = await fetch(GOOGLE_EVENTS(calId), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: appt.summary,
          description: appt.description,
          start: { dateTime: appt.startISO },
          end: { dateTime: appt.endISO },
          attendees: appt.attendees?.map((email) => ({ email })),
          extendedProperties: {
            private: { onsecboadAppointmentId: appt.appointmentId },
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Google API ${res.status}: ${text.slice(0, 200)}`);
      }
      const created = (await res.json()) as { id?: string };
      if (created.id) {
        await prisma.appointmentExternalEvent.upsert({
          where: {
            appointmentId_connectionId: {
              appointmentId: appt.appointmentId,
              connectionId: c.id,
            },
          },
          create: {
            appointmentId: appt.appointmentId,
            connectionId: c.id,
            provider: 'google',
            externalEventId: created.id,
          },
          update: { externalEventId: created.id },
        });
      }
      await prisma.calendarConnection.update({
        where: { id: c.id },
        data: { lastSyncedAt: new Date(), lastError: null },
      });
    } catch (err) {
      logger.warn(
        {
          err,
          connectionId: c.id,
          userId,
          appointmentId: appt.appointmentId,
        },
        'google calendar push failed',
      );
      await prisma.calendarConnection.update({
        where: { id: c.id },
        data: {
          lastError: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          status: /invalid_grant|unauthorized/i.test(
            err instanceof Error ? err.message : '',
          )
            ? 'revoked'
            : c.status,
        },
      });
    }
  }
}
