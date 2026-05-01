/**
 * Microsoft Graph (Outlook / Microsoft 365) calendar wrapper. Mirrors
 * google-calendar.ts exactly — same flows, different endpoints + payload
 * shapes.
 *
 *   Authorize:    https://login.microsoftonline.com/common/oauth2/v2.0/authorize
 *   Token:        https://login.microsoftonline.com/common/oauth2/v2.0/token
 *   User info:    https://graph.microsoft.com/v1.0/me
 *   Create event: POST https://graph.microsoft.com/v1.0/me/events
 *
 * Tokens use AES-256-GCM column encryption shared with TOTP secrets.
 */
import { encryptString, decryptString } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';

const env = loadEnv();

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_ME = 'https://graph.microsoft.com/v1.0/me';
const MS_EVENTS = 'https://graph.microsoft.com/v1.0/me/events';

const SCOPES = ['openid', 'email', 'offline_access', 'Calendars.ReadWrite'].join(' ');

export function outlookConnectUrl(state: string): string | null {
  if (!env.MS_OAUTH_CLIENT_ID) return null;
  const redirect = `${env.API_URL.replace(/\/$/, '')}/api/v1/calendar/outlook/callback`;
  const u = new URL(MS_AUTH);
  u.searchParams.set('client_id', env.MS_OAUTH_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES);
  u.searchParams.set('response_mode', 'query');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'consent');
  return u.toString();
}

type TokenResp = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
};

export async function exchangeOutlookCode(code: string): Promise<TokenResp> {
  if (!env.MS_OAUTH_CLIENT_ID || !env.MS_OAUTH_CLIENT_SECRET) {
    throw new Error('Microsoft OAuth not configured');
  }
  const redirect = `${env.API_URL.replace(/\/$/, '')}/api/v1/calendar/outlook/callback`;
  const body = new URLSearchParams({
    code,
    client_id: env.MS_OAUTH_CLIENT_ID,
    client_secret: env.MS_OAUTH_CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
    scope: SCOPES,
  });
  const res = await fetch(MS_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MS token exchange ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResp;
}

async function refreshOutlookToken(refreshToken: string): Promise<TokenResp> {
  if (!env.MS_OAUTH_CLIENT_ID || !env.MS_OAUTH_CLIENT_SECRET) {
    throw new Error('Microsoft OAuth not configured');
  }
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.MS_OAUTH_CLIENT_ID,
    client_secret: env.MS_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
    scope: SCOPES,
  });
  const res = await fetch(MS_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`MS token refresh ${res.status}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResp;
}

export async function fetchOutlookEmail(accessToken: string): Promise<string> {
  const res = await fetch(MS_ME, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`/me failed: ${res.status}`);
  const data = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return data.mail ?? data.userPrincipalName ?? 'unknown@outlook';
}

async function getActiveAccessToken(connectionId: string): Promise<string> {
  const conn = await prisma.calendarConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.status !== 'active') throw new Error('connection not active');
  const accessToken = decryptString(conn.accessTokenEnc);
  if (conn.expiresAt.getTime() > Date.now() + 60_000) return accessToken;
  if (!conn.refreshTokenEnc) throw new Error('access token expired and no refresh token');
  const refreshToken = decryptString(conn.refreshTokenEnc);
  const fresh = await refreshOutlookToken(refreshToken);
  await prisma.calendarConnection.update({
    where: { id: conn.id },
    data: {
      accessTokenEnc: encryptString(fresh.access_token),
      ...(fresh.refresh_token ? { refreshTokenEnc: encryptString(fresh.refresh_token) } : {}),
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

export async function updateAppointmentOnOutlook(
  appointmentId: string,
  patch: Partial<AppointmentToSync>,
): Promise<void> {
  const links = await prisma.appointmentExternalEvent.findMany({
    where: { appointmentId, provider: 'outlook' },
    include: { connection: true },
  });
  for (const link of links) {
    if (link.connection.status !== 'active') continue;
    try {
      const token = await getActiveAccessToken(link.connectionId);
      const body: Record<string, unknown> = {};
      if (patch.summary !== undefined) body.subject = patch.summary;
      if (patch.description !== undefined) {
        body.body = { contentType: 'text', content: patch.description };
      }
      if (patch.startISO !== undefined) {
        body.start = { dateTime: patch.startISO, timeZone: 'UTC' };
      }
      if (patch.endISO !== undefined) {
        body.end = { dateTime: patch.endISO, timeZone: 'UTC' };
      }
      const res = await fetch(`${MS_EVENTS}/${encodeURIComponent(link.externalEventId)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Graph PATCH ${res.status}`);
    } catch (err) {
      logger.warn({ err, link }, 'outlook update failed');
    }
  }
}

export async function deleteAppointmentOnOutlook(appointmentId: string): Promise<void> {
  const links = await prisma.appointmentExternalEvent.findMany({
    where: { appointmentId, provider: 'outlook' },
    include: { connection: true },
  });
  for (const link of links) {
    if (link.connection.status !== 'active') continue;
    try {
      const token = await getActiveAccessToken(link.connectionId);
      const res = await fetch(
        `${MS_EVENTS}/${encodeURIComponent(link.externalEventId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.status !== 204 && !res.ok) throw new Error(`Graph DELETE ${res.status}`);
      await prisma.appointmentExternalEvent.delete({ where: { id: link.id } });
    } catch (err) {
      logger.warn({ err, link }, 'outlook delete failed');
    }
  }
}

export async function pushAppointmentToOutlook(
  userId: string,
  appt: AppointmentToSync,
): Promise<void> {
  const conns = await prisma.calendarConnection.findMany({
    where: { userId, provider: 'outlook', status: 'active' },
  });
  for (const c of conns) {
    try {
      const token = await getActiveAccessToken(c.id);
      const res = await fetch(MS_EVENTS, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject: appt.summary,
          body: {
            contentType: 'text',
            content: appt.description ?? '',
          },
          start: { dateTime: appt.startISO, timeZone: 'UTC' },
          end: { dateTime: appt.endISO, timeZone: 'UTC' },
          attendees: (appt.attendees ?? []).map((email) => ({
            emailAddress: { address: email },
            type: 'required',
          })),
          singleValueExtendedProperties: [
            {
              id: 'String {66f5a359-4659-4830-9070-00040ec6ac6e} Name OnsecBoadAppointmentId',
              value: appt.appointmentId,
            },
          ],
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Graph ${res.status}: ${text.slice(0, 200)}`);
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
            provider: 'outlook',
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
        { err, connectionId: c.id, userId, appointmentId: appt.appointmentId },
        'outlook push failed',
      );
      await prisma.calendarConnection.update({
        where: { id: c.id },
        data: {
          lastError: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          status: /invalid_grant|unauthorized|AADSTS700/i.test(
            err instanceof Error ? err.message : '',
          )
            ? 'revoked'
            : c.status,
        },
      });
    }
  }
}
