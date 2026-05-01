/**
 * Microsoft (Outlook) OAuth start + callback. Mirrors calendar-google.ts.
 */
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { encryptString, verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import {
  exchangeOutlookCode,
  fetchOutlookEmail,
  outlookConnectUrl,
} from '../lib/outlook-calendar.js';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const env = loadEnv();
const STATE_TTL = 5 * 60;

export async function outlookConnectHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.query.token ?? '');
  if (!token) {
    res.status(401).send('Missing access token. Sign in first.');
    return;
  }
  let claims;
  try {
    claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET);
  } catch {
    res.status(401).send('Invalid token. Sign in again.');
    return;
  }
  if (claims.scope !== 'firm') {
    res.status(403).send('Firm users only.');
    return;
  }
  const state = randomBytes(24).toString('base64url');
  await redis.set(
    `oauth:outlook:${state}`,
    JSON.stringify({ userId: claims.sub, tenantId: claims.tenantId }),
    'EX',
    STATE_TTL,
  );
  const url = outlookConnectUrl(state);
  if (!url) {
    res.status(503).send('Microsoft OAuth not configured. Set MS_OAUTH_CLIENT_ID.');
    return;
  }
  res.redirect(url);
}

export async function outlookCallbackHandler(req: Request, res: Response): Promise<void> {
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const err = String(req.query.error ?? '');
  const appUrl = env.APP_URL.replace(/\/$/, '');

  if (err) {
    res.redirect(`${appUrl}/settings/profile?calendar=denied`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${appUrl}/settings/profile?calendar=missing`);
    return;
  }
  const raw = await redis.get(`oauth:outlook:${state}`);
  if (!raw) {
    res.redirect(`${appUrl}/settings/profile?calendar=expired`);
    return;
  }
  await redis.del(`oauth:outlook:${state}`);
  const ctx = JSON.parse(raw) as { userId: string; tenantId: string };

  let tokens;
  let email: string;
  try {
    tokens = await exchangeOutlookCode(code);
    email = await fetchOutlookEmail(tokens.access_token);
  } catch (e) {
    logger.warn({ err: e }, 'outlook oauth exchange failed');
    res.redirect(`${appUrl}/settings/profile?calendar=failed`);
    return;
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const accessTokenEnc = encryptString(tokens.access_token);
  const refreshTokenEnc = tokens.refresh_token ? encryptString(tokens.refresh_token) : null;

  await prisma.calendarConnection.upsert({
    where: {
      userId_provider_externalAccount: {
        userId: ctx.userId,
        provider: 'outlook',
        externalAccount: email,
      },
    },
    create: {
      userId: ctx.userId,
      provider: 'outlook',
      externalAccount: email,
      accessTokenEnc,
      refreshTokenEnc,
      expiresAt,
      scope: tokens.scope,
      status: 'active',
    },
    update: {
      accessTokenEnc,
      ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
      expiresAt,
      scope: tokens.scope,
      status: 'active',
      lastError: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorType: 'USER',
      action: 'calendar.outlook.connect',
      targetType: 'User',
      targetId: ctx.userId,
      payload: { externalAccount: email },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    },
  });

  res.redirect(`${appUrl}/settings/profile?calendar=connected`);
}
