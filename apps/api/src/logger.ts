import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'api' },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash'],
    censor: '[REDACTED]',
  },
});
