/**
 * Small helpers shared by the database scripts (migrate / seed / perf data).
 */
import path from 'node:path';
import { config } from 'dotenv';

/** Loads the repo-root .env when running on the host. In Docker the variables already exist. */
export function loadEnv(): void {
  config({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
}

/** One JSON line per message, the same structured format the apps use. */
export function log(message: string, level: 'info' | 'error' = 'info'): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'db-scripts',
    msg: message,
  });
  if (level === 'error') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}
