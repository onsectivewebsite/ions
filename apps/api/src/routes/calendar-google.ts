/**
 * Google Calendar OAuth start + callback. Auth-gated start (firm user
 * via access token in ?token=...); callback validates state and stores
 * encrypted tokens in CalendarConnection.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '@onsecboad/db';
import { encryptString, verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import {
  exchangeGoogleCode,
  fetchGoogleEmail,
  googleConnectUrl,
} from '../lib/google-calendar.js';
import { redis } from '../redis.js';
import { logger } from '../logger.js';

const env = loadEnv();
const STATE_TTL = 5 * 60;

export async function googleConnectHandler(req: Request, res: Response): Promise<void> {
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
    `oauth:google:${state}`,
    JSON.stringify({ userId: claims.sub, tenantId: claims.tenantId }),
    'EX',
    STATE_TTL,
  );
  const url = googleConnectUrl(state);
  if (!url) {
    res.status(503).send('Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID.');
    return;
  }
  res.redirect(url);
}

export async function googleCallbackHandler(req: Request, res: Response): Promise<void> {
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
  const raw = await redis.get(`oauth:google:${state}`);
  if (!raw) {
    res.redirect(`${appUrl}/settings/profile?calendar=expired`);
    return;
  }
  await redis.del(`oauth:google:${state}`);
  const ctx = JSON.parse(raw) as { userId: string; tenantId: string };

  let tokens;
  let email: string;
  try {
    tokens = await exchangeGoogleCode(code);
    email = await fetchGoogleEmail(tokens.access_token);
  } catch (e) {
    logger.warn({ err: e }, 'google oauth exchange failed');
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
        provider: 'google',
        externalAccount: email,
      },
    },
    create: {
      userId: ctx.userId,
      provider: 'google',
      externalAccount: email,
      accessTokenEnc,
      refreshTokenEnc,
      expiresAt,
      scope: tokens.scope,
      status: 'active',
    },
    update: {
      accessTokenEnc,
      // Google only returns refresh_token on first consent.
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
      action: 'calendar.google.connect',
      targetType: 'User',
      targetId: ctx.userId,
      payload: { externalAccount: email },
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    },
  });

  res.redirect(`${appUrl}/settings/profile?calendar=connected`);
}
