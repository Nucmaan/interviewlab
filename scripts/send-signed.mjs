#!/usr/bin/env node
/**
 * Sends a correctly signed request to the channel APIs, the way a bank or mobile money provider
 * would. Handy for demos and manual testing.
 *
 *   node scripts/send-signed.mjs bulk     path/to/payments.json [idempotency-key]
 *   node scripts/send-signed.mjs callback path/to/callback.json [idempotency-key]
 *
 * Reads CHANNEL_CALLBACK_SECRET and IRCUB_URL (default http://localhost:3000) from the environment
 * or the repo-root .env file.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../.env'));
} catch {
  // No .env file: rely on real environment variables.
}

const [kind, file, key = randomUUID()] = process.argv.slice(2);
if (!['bulk', 'callback'].includes(kind ?? '') || !file) {
  process.stderr.write(
    'usage: node scripts/send-signed.mjs <bulk|callback> <file.json> [idempotency-key]\n',
  );
  process.exit(2);
}

const secret = process.env.CHANNEL_CALLBACK_SECRET;
if (!secret) {
  process.stderr.write('CHANNEL_CALLBACK_SECRET is not set\n');
  process.exit(2);
}
const baseUrl = process.env.IRCUB_URL ?? 'http://localhost:3000';
const body = readFileSync(file, 'utf8');
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

const response = await fetch(`${baseUrl}/api/payments/${kind}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Timestamp': timestamp,
    'X-Signature': signature,
    'Idempotency-Key': key,
  },
  body,
});
process.stdout.write(
  `HTTP ${response.status}${response.headers.get('idempotent-replayed') ? ' (replayed)' : ''}\n`,
);
process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
