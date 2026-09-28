import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@ircub/db';
import { prisma } from '@/lib/db';

/** Marks a key whose first request is still running. */
const IN_PROGRESS = 0;

export interface StoredResponse {
  status: number;
  body: unknown;
  replayed: boolean;
}

/**
 * Idempotency keys (Part 1, Payment Notification API).
 *
 * Channels retry when they time out, so the same request can arrive several times. The client
 * sends an `Idempotency-Key` header; we remember the key and the response:
 *   - same key + same body again  -> return the ORIGINAL response, do nothing new
 *   - same key + different body   -> 422, the client has a bug
 *   - same key while still running -> 409, try again shortly
 *
 * The key is claimed with INSERT ... ON CONFLICT DO NOTHING before any work starts, so two
 * identical requests arriving at the same moment cannot both be processed.
 */
export async function withIdempotency(
  key: string,
  endpoint: string,
  rawBody: string,
  handler: () => Promise<{ status: number; body: unknown }>,
): Promise<StoredResponse> {
  const requestHash = createHash('sha256').update(rawBody).digest('hex');

  const claimed = await prisma.$executeRaw`
    INSERT INTO idempotency_key (key, request_hash, endpoint, response_status, response_body)
    VALUES (${key}, ${requestHash}, ${endpoint}, ${IN_PROGRESS}, '{}'::jsonb)
    ON CONFLICT (key) DO NOTHING`;

  if (claimed === 0) {
    const existing = await prisma.idempotencyKey.findUnique({ where: { key } });
    if (!existing) {
      // The first request failed and released the key between our insert and this read.
      return {
        status: 409,
        body: { error: 'Request is being retried, please try again' },
        replayed: false,
      };
    }
    if (existing.request_hash !== requestHash || existing.endpoint !== endpoint) {
      return {
        status: 422,
        body: { error: 'Idempotency-Key was already used with a different request' },
        replayed: false,
      };
    }
    if (existing.response_status === IN_PROGRESS) {
      return {
        status: 409,
        body: { error: 'A request with this Idempotency-Key is still being processed' },
        replayed: false,
      };
    }
    return { status: existing.response_status, body: existing.response_body, replayed: true };
  }

  try {
    const result = await handler();
    await prisma.idempotencyKey.update({
      where: { key },
      data: { response_status: result.status, response_body: result.body as Prisma.InputJsonValue },
    });
    return { ...result, replayed: false };
  } catch (error) {
    // Release the key so the client's retry is processed normally.
    await prisma.idempotencyKey.delete({ where: { key } }).catch(() => undefined);
    throw error;
  }
}
