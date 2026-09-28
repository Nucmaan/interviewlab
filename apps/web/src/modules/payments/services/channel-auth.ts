import 'server-only';
import { verifySignature } from '@ircub/core';
import { rateLimit } from '@ircub/platform';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';

/** Requests per minute allowed from one channel IP (month-end peak is ~5,000 payments/min in bulk). */
const CHANNEL_RATE_LIMIT_PER_MINUTE = 1200;

/**
 * Authenticates a machine-to-machine request from a bank or mobile money provider:
 * rate limit -> HMAC signature + timestamp -> Idempotency-Key present.
 * Returns the raw body (needed for the signature and the idempotency hash) or an error response.
 */
export async function authenticateChannelRequest(
  request: NextRequest,
): Promise<
  { ok: true; rawBody: string; idempotencyKey: string } | { ok: false; response: Response }
> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  try {
    const limit = await rateLimit(redis(), `channel:${ip}`, CHANNEL_RATE_LIMIT_PER_MINUTE, 60);
    if (!limit.allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
        ),
      };
    }
  } catch (error) {
    // Fail open on a Redis outage: signature checks below still protect the endpoint.
    logger.warn({ err: error }, 'rate limiter unavailable');
  }

  const rawBody = await request.text();
  const check = verifySignature({
    secret: env().CHANNEL_CALLBACK_SECRET,
    timestamp: request.headers.get('x-timestamp'),
    signature: request.headers.get('x-signature'),
    rawBody,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!check.ok) {
    logger.warn(
      { ip, reason: check.reason, path: request.nextUrl.pathname },
      'rejected channel request',
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid signature', reason: check.reason },
        { status: 401 },
      ),
    };
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Idempotency-Key header is required (max 128 characters)' },
        { status: 400 },
      ),
    };
  }
  return { ok: true, rawBody, idempotencyKey };
}

export function parseJson(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}
