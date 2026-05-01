import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  PORTAL_URL: z.string().url(),
  API_URL: z.string().url(),
  PUBLIC_DOMAIN: z.string().min(1),

  DATABASE_URL: z.string().url(),
  DATABASE_REPLICA_URL: z.string().url().optional().or(z.literal('')),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),

  ENCRYPTION_KEY_BASE64: z.string().min(40),

  WEBAUTHN_RP_NAME: z.string().min(1).default('OnsecBoad'),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_ORIGIN: z.string().url(),

  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  EMAIL_FROM_DEFAULT: z.string().min(1).default('OnsecBoad <donotreply@onsective.com>'),
  EMAIL_DRY_RUN: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false'),

  R2_ENDPOINT: z.string().optional(),
  R2_REGION: z.string().default('auto'),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // When true, the Stripe client logs operations and returns plausible mock
  // responses instead of hitting Stripe. Auto-enabled when STRIPE_SECRET_KEY
  // looks like a dummy ('sk_dummy*' / unset / starts with 'sk_test_dummy').
  STRIPE_DRY_RUN: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false'),
  STRIPE_TRIAL_DAYS: z.coerce.number().int().min(0).max(60).default(14),

  // Background jobs (in-process scheduler). Off by default so dev stays quiet.
  ENABLE_CRON: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false'),
  CRON_SEAT_RECONCILE: z.string().default('0 2 * * *'), // daily at 02:00 UTC
  // Phase 8.3 — daily missing-docs agent scan. Defaults to 14:00 UTC
  // (early morning North America) which works for typical Canadian
  // immigration firm hours.
  CRON_AI_AGENT_TICK: z.string().default('0 14 * * *'),
  // Phase 10.1 — daily PIPEDA data purge. 03:00 UTC keeps it off the
  // hot path for North-American business hours.
  CRON_DATA_PURGE: z.string().default('0 3 * * *'),

  // Phase 9.5 — Expo Push delivery. Default true so dev doesn't fan out
  // to phantom devices; flip to false in prod once devices are wired.
  PUSH_DRY_RUN: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('true'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  // Default model for Phase 6 AI extraction. Override per-tenant if a firm
  // wants to use a different tier (Sonnet for cheaper/faster extraction).
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),
  // Force dry-run regardless of API key — useful for staging/dev where the
  // key exists but you don't want to burn tokens.
  AI_DRY_RUN: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  // Stage 14.1 — shared secret used by /api/v1/webhooks/email to
  // authenticate provider callbacks (Postmark/SendGrid/Resend/SES).
  // Configure the same value at the provider's webhook target.
  EMAIL_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset cache — used in tests. */
export function _resetEnvCache(): void {
  cached = null;
}
