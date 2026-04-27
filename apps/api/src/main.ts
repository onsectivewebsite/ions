/**
 * Standalone API host. Serves tRPC under /trpc and a few REST endpoints
 * (health, ready, webhooks). Web app calls this via fetch.
 */
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import cors from 'cors';
import express from 'express';
import pinoHttp from 'pino-http';
import { loadEnv } from '@onsecboad/config';
import { prisma } from '@onsecboad/db';
import { createContext } from './context.js';
import { appRouter } from './router.js';
import { logger } from './logger.js';
import { redis } from './redis.js';
import { stripeWebhookHandler } from './webhooks/stripe.js';
import {
  twilioVoiceStatusHandler,
  twilioRecordingStatusHandler,
  twilioSmsIncomingHandler,
} from './webhooks/twilio.js';
import { leadsIngestHandler } from './routes/leads-ingest.js';
import { startScheduledJobs } from './jobs/scheduler.js';

const env = loadEnv();
const app = express();

app.use(pinoHttp({ logger }));
app.use(
  cors({
    origin: [env.APP_URL, env.PORTAL_URL],
    credentials: true,
  }),
);

// Stripe webhook MUST be mounted with a raw body parser BEFORE any JSON middleware
// so the SDK can verify the signature against the original bytes.
app.post(
  '/api/v1/webhooks/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeWebhookHandler,
);

// Public lead ingest endpoint — bearer auth via firm API key.
app.post(
  '/api/v1/leads/ingest',
  express.json({ limit: '256kb' }),
  leadsIngestHandler,
);

// Twilio webhooks — Twilio sends url-encoded form bodies, not JSON.
const twilioBody = express.urlencoded({ extended: false, limit: '128kb' });
app.post('/api/v1/webhooks/twilio-voice/status', twilioBody, twilioVoiceStatusHandler);
app.post('/api/v1/webhooks/twilio-recording/status', twilioBody, twilioRecordingStatusHandler);
app.post('/api/v1/webhooks/twilio-sms/incoming', twilioBody, twilioSmsIncomingHandler);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = {};
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
  }
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'fail';
  }
  const allOk = Object.values(checks).every((v) => v === 'ok');
  res.status(allOk ? 200 : 503).json({ ok: allOk, checks });
});

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error, path }) {
      logger.error({ err: error, path }, 'tRPC error');
    },
  }),
);

const port = Number(new URL(env.API_URL).port || 4000);
app.listen(port, () => {
  logger.info({ port, env: env.NODE_ENV }, 'API listening');
  startScheduledJobs();
});
