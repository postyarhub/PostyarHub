import pino from 'pino';
import { loadEnv } from '../config/env.js';

/** Structured logging with redaction (§62). Never log credentials. */
export function createLogger(name: string) {
  const env = loadEnv();
  return pino({
    name,
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.password_hash',
        '*.token',
        '*.token_encrypted',
        '*.bot_token',
        '*.api_key',
        '*.secret',
        '*.webhook_secret',
        '*.authorization',
      ],
      censor: '[REDACTED]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
