/**
 * Structured JSON logging with pino. Every line carries the service name, so logs from web,
 * worker and mock services can be searched together. Sensitive fields are redacted so a
 * password or TOTP secret can never end up in a log file by accident.
 */
import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        '*.password',
        'password_hash',
        '*.password_hash',
        'totp_secret',
        '*.totp_secret',
        'secret',
        'headers.authorization',
        'headers.cookie',
        'headers["x-signature"]',
      ],
      censor: '[REDACTED]',
    },
  });
}
