/**
 * Server-Sent Events stream — realtime push to authenticated firm users.
 *
 * GET /api/v1/stream
 *   Auth: ?token=<accessJwt> (browsers can't set Authorization on EventSource)
 *
 * Each connection subscribes to:
 *   tenant:<tenantId>
 *   tenant:<tenantId>:branch:<branchId>   (if user has a branch)
 *   tenant:<tenantId>:user:<userId>
 *
 * We send a 25s heartbeat comment line to defeat reverse-proxy idle timeouts
 * (CloudPanel/nginx default = 60s) and to give the client a quick way to
 * detect a dead socket (no `ping` event for ~30s = reconnect).
 */
import type { Request, Response } from 'express';
import { verifyAccessToken } from '@onsecboad/auth';
import { loadEnv } from '@onsecboad/config';
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';
import { channelsForUser, subscribeChannels, type RealtimeEvent } from '../lib/realtime.js';

const env = loadEnv();

export async function streamHandler(req: Request, res: Response): Promise<void> {
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
  if (claims.scope !== 'firm' || !claims.tenantId) {
    res.status(403).json({ ok: false, error: 'Firm-scope token required' });
    return;
  }

  // Pull branch (so the user gets branch-wide events too).
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { branchId: true, status: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.status !== 'ACTIVE') {
    res.status(403).json({ ok: false, error: 'User not active' });
    return;
  }

  // SSE headers. Keep the connection open and disable any framework buffering.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx
  });
  res.flushHeaders();

  // Send a hello so the client knows the stream is live.
  res.write(`: connected\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const channels = channelsForUser({
    tenantId: claims.tenantId,
    userId: claims.sub,
    branchId: user.branchId,
  });

  const send = (ev: RealtimeEvent): void => {
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
  };
  const dispose = subscribeChannels(channels, send);

  // Heartbeat to keep proxies happy + give the client a liveness signal.
  const heartbeat = setInterval(() => {
    res.write(`: hb\n\n`);
  }, 25_000);

  const cleanup = (reason: string): void => {
    clearInterval(heartbeat);
    dispose();
    logger.debug({ userId: claims.sub, reason }, 'sse closed');
  };

  req.on('close', () => cleanup('client-closed'));
  req.on('error', (e) => {
    logger.warn({ err: e }, 'sse req error');
    cleanup('req-error');
  });
}
