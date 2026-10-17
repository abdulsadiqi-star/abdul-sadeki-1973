/**
 * Structured logging (pino). One JSON line per event on stdout.
 *
 *   logger.info({ videoId, userId }, 'video published');
 *   const log = logger.child({ module: 'worker' });
 *
 * Secrets are redacted. Output is always JSON; for readable local output pipe it:
 *   pnpm dev 2>&1 | pnpm exec pino-pretty
 */
import pino from 'pino';

const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');

const options: pino.LoggerOptions = {
  level,
  base: { service: process.env.SERVICE_NAME ?? 'web' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
  redact: {
    paths: [
      'password',
      'newPassword',
      'currentPassword',
      'passwordHash',
      'token',
      'secret',
      '*.password',
      '*.newPassword',
      '*.passwordHash',
      '*.token',
      'headers.cookie',
      'headers.authorization',
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
};

const createLogger = (): pino.Logger => pino(options);

const globalForLogger = globalThis as unknown as { __logger?: pino.Logger };

export const logger: pino.Logger = globalForLogger.__logger ?? (globalForLogger.__logger = createLogger());

export type Logger = pino.Logger;
