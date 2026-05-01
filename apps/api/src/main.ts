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
import {
  metaLeadsVerifyHandler,
  metaLeadsWebhookHandler,
} from './webhooks/meta.js';
import { tiktokLeadsWebhookHandler } from './webhooks/tiktok.js';
import { leadsIngestHandler } from './routes/leads-ingest.js';
import { streamHandler } from './routes/stream.js';
import { portalStreamHandler } from './routes/portal-stream.js';
import {
  staffUploadHandler,
  publicCollectionGetHandler,
  publicCollectionUploadHandler,
  publicCollectionSubmitHandler,
  portalUploadHandler,
} from './routes/document-upload.js';
import { pdfTemplateUploadHandler } from './routes/pdf-template-upload.js';
import { uploadLogoHandler, logoProxyHandler } from './routes/tenant-logo.js';
import {
  publicIntakeGetHandler,
  publicIntakeSubmitHandler,
} from './routes/public-intake.js';
import { emailWebhookHandler } from './webhooks/email.js';
import {
  emailOpenHandler,
  emailClickHandler,
} from './routes/email-tracking.js';
import {
  googleConnectHandler,
  googleCallbackHandler,
} from './routes/calendar-google.js';
import {
  outlookConnectHandler,
  outlookCallbackHandler,
} from './routes/calendar-outlook.js';
import { userCalendarFeedHandler } from './routes/calendar-feed.js';
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

// Meta + TikTok lead webhooks — raw body so HMAC can be checked against
// original bytes. Meta also needs a GET handler for subscription verification.
const adsBody = express.raw({ type: 'application/json', limit: '512kb' });
app.get('/api/v1/webhooks/meta-leads', metaLeadsVerifyHandler);
app.post('/api/v1/webhooks/meta-leads', adsBody, metaLeadsWebhookHandler);
app.post('/api/v1/webhooks/tiktok-leads', adsBody, tiktokLeadsWebhookHandler);

// SSE realtime stream — bearer token via ?token= since EventSource can't
// set headers. Firm-scope only; auth is checked inside the handler.
app.get('/api/v1/stream', streamHandler);

// Portal SSE — same pattern but for client scope. Subscribes to the
// per-client channel so messages + case updates flow without polling.
app.get('/api/v1/portal/stream', portalStreamHandler);

// Document uploads — body is raw bytes (Content-Type:
// application/octet-stream), metadata in query string. 50 MB cap covers
// typical immigration PDFs/photos with headroom.
const fileBody = express.raw({ type: '*/*', limit: '50mb' });
app.post('/api/v1/cases/:caseId/upload', fileBody, staffUploadHandler);
app.get('/api/v1/dc/:token', publicCollectionGetHandler);
app.post('/api/v1/dc/:token/upload', fileBody, publicCollectionUploadHandler);
app.post('/api/v1/dc/:token/submit', express.json({ limit: '4kb' }), publicCollectionSubmitHandler);
// Portal-authenticated upload — Phase 7.5. Same body shape as the public
// path but JWT-gated (scope=client) and chained through the portal account.
app.post('/api/v1/portal/cases/:caseId/upload', fileBody, portalUploadHandler);

// PDF form template uploads — same raw-bytes pattern as documents.
app.post('/api/v1/pdf-templates', fileBody, pdfTemplateUploadHandler);

// Tenant logo: 2MB raw image bytes for upload, public proxy for serving.
const logoBody = express.raw({ type: 'image/*', limit: '2mb' });
app.post('/api/v1/tenant/logo', logoBody, uploadLogoHandler);
app.get('/api/v1/tenant/:tenantId/logo', logoProxyHandler);

// Public intake form (no auth — token in URL).
app.get('/api/v1/intake/:token', publicIntakeGetHandler);
app.post(
  '/api/v1/intake/:token/submit',
  express.json({ limit: '256kb' }),
  publicIntakeSubmitHandler,
);

// Built-in email tracking (open pixel + click redirect).
app.get('/api/v1/email/open/:id', emailOpenHandler);
app.get('/api/v1/email/click/:id', emailClickHandler);

// Google Calendar OAuth — auth via ?token= since the browser does the
// redirect dance and can't set Authorization headers.
app.get('/api/v1/calendar/google/connect', googleConnectHandler);
app.get('/api/v1/calendar/google/callback', googleCallbackHandler);
app.get('/api/v1/calendar/outlook/connect', outlookConnectHandler);
app.get('/api/v1/calendar/outlook/callback', outlookCallbackHandler);

// Per-user iCal feed — calendar apps subscribe via this URL with a JWT
// in the query string. See routes/calendar-feed.ts for details.
app.get('/api/v1/users/:userId/calendar.ics', userCalendarFeedHandler);

// Email-provider webhook (deliverability + bounce + complaint events).
// Auth via shared secret in Authorization header. Body is JSON of varying
// shapes — handler normalizes Postmark / SendGrid / Resend / SES.
app.post(
  '/api/v1/webhooks/email',
  express.json({ limit: '512kb' }),
  emailWebhookHandler,
);

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

// Phase 10.2 — public health-full endpoint backing the status page.
// Same probes as /ready plus integration-config visibility (Stripe key
// configured? AI key? R2?). Public on purpose — the status page renders
// this verbatim. Deliberately does NOT touch external services from the
// request (no live Stripe/Twilio/Anthropic ping); just config + local
// dependencies. Production health monitoring should use a separate
// uptime probe (Better Stack, Pingdom, etc).
app.get('/api/health/full', async (_req, res) => {
  const components: Array<{ name: string; status: 'ok' | 'degraded' | 'down'; detail?: string }> = [];

  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    components.push({ name: 'database', status: 'ok' });
  } catch (e) {
    components.push({
      name: 'database',
      status: 'down',
      detail: e instanceof Error ? e.message : 'unreachable',
    });
  }

  try {
    await redis.ping();
    components.push({ name: 'redis', status: 'ok' });
  } catch (e) {
    components.push({
      name: 'redis',
      status: 'down',
      detail: e instanceof Error ? e.message : 'unreachable',
    });
  }

  const r2Configured =
    !!env.R2_ENDPOINT && !!env.R2_ACCESS_KEY_ID && !!env.R2_SECRET_ACCESS_KEY && !!env.R2_BUCKET;
  components.push({
    name: 'r2',
    status: r2Configured ? 'ok' : 'degraded',
    detail: r2Configured ? undefined : 'dry-run (no R2 credentials configured)',
  });

  const stripeConfigured = !!env.STRIPE_SECRET_KEY && !env.STRIPE_DRY_RUN;
  components.push({
    name: 'stripe',
    status: stripeConfigured ? 'ok' : 'degraded',
    detail: stripeConfigured ? undefined : 'dry-run',
  });

  const aiConfigured = !!env.ANTHROPIC_API_KEY && !env.AI_DRY_RUN;
  components.push({
    name: 'ai',
    status: aiConfigured ? 'ok' : 'degraded',
    detail: aiConfigured ? undefined : 'dry-run',
  });

  const overall: 'ok' | 'degraded' | 'down' = components.some((c) => c.status === 'down')
    ? 'down'
    : components.some((c) => c.status === 'degraded')
      ? 'degraded'
      : 'ok';

  res.status(overall === 'down' ? 503 : 200).json({
    overall,
    checkedAt: new Date().toISOString(),
    components,
  });
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
