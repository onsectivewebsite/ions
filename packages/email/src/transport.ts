import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '@onsecboad/config';

let cached: Transporter | null = null;

export function getTransport(): Transporter {
  if (cached) return cached;
  const env = loadEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error(
      'SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env (see .env.example).',
    );
  }
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    // 10s connect timeout — fail fast if reachable.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return cached;
}

/** Reset the cached transport — for tests. */
export function _resetTransport(): void {
  cached = null;
}
