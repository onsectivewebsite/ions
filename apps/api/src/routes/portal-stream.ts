/**
 * Portal SSE stream — realtime push to authenticated client-portal users.
 *
 * GET /api/v1/portal/stream
 *   Auth: ?token=<accessJwt with scope=client>
 *
 * Each connection subscribes to one channel:
 *   tenant:<tenantId>:client:<clientId>
 *
 * Used by the portal messages page to refresh on new STAFF replies, and
 * by the portal case page to react to status / appointment changes.
 *
 * Mirrors apps/api/src/routes/stream.ts but for client scope. Kept as a
 * separate route so we can lock auth + channel scope down without
 * branching the firm pipeline.
 */
import type { Request, Response } from 'express';
import { verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';
import { channelsForClient, subscribeChannels, type RealtimeEvent } from '../lib/realtime.js';

const env = loadEnv();

export async function portalStreamHandler(req: Request, res: Response): Promise<void> {
  const token = String(req.query.token ?? '');
  if (!token) {
    res.status(401).json({ ok: false, error: 'Missing token' });
    return;
  }
  let claims;
  try {
    claims = await verifyAccessToken(token, env.JWT_ACCESS_SECRET);
  } catch {
    res.status(401).json({ ok: false, error: 'Invalid token' });
    return;
  }
  if (claims.scope !== 'client' || !claims.tenantId) {
    res.status(403).json({ ok: false, error: 'Client-scope token required' });
    return;
  }

  // The portal token's `sub` is the ClientPortalAccount id, not the
  // Client id. Resolve to the underlying clientId so we subscribe to
  // the right channel.
  const account = await prisma.clientPortalAccount.findUnique({
    where: { id: claims.sub },
    select: { clientId: true, status: true, deletedAt: true },
  });
  if (!account || account.deletedAt || account.status !== 'ACTIVE') {
    res.status(403).json({ ok: false, error: 'Portal account not active' });
    return;
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`: connected\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const channels = channelsForClient({
    tenantId: claims.tenantId,
    clientId: account.clientId,
  });

  const send = (ev: RealtimeEvent): void => {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  const dispose = subscribeChannels(channels, send);

  const heartbeat = setInterval(() => {
    res.write(`: hb\n\n`);
  }, 25_000);

  const cleanup = (reason: string): void => {
    clearInterval(heartbeat);
    dispose();
    logger.debug({ accountId: claims.sub, reason }, 'portal sse closed');
  };

  req.on('close', () => cleanup('client-closed'));
  req.on('error', (e) => {
    logger.warn({ err: e }, 'portal sse req error');
    cleanup('req-error');
  });
}
