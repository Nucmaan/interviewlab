/**
 * HMAC request signing for payment channel callbacks (Part 1, Payment Notification API).
 *
 * The channel and IRCUB share a secret. The channel sends:
 *   X-Timestamp: unix seconds
 *   X-Signature: hex( HMAC-SHA256(secret, timestamp + "." + rawBody) )
 *
 * - Signing the RAW body (not re-serialised JSON) means any change to the bytes breaks the
 *   signature.
 * - Including the timestamp and rejecting old requests stops an attacker replaying a captured,
 *   validly signed callback later.
 * - timingSafeEqual compares in constant time, so response timing does not leak how many
 *   characters of a guessed signature were correct.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function computeSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'MISSING_HEADERS' | 'INVALID_TIMESTAMP' | 'EXPIRED' | 'BAD_SIGNATURE' };

export function verifySignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowSeconds: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { secret, timestamp, signature, rawBody, nowSeconds } = input;
  const tolerance = input.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;

  if (!timestamp || !signature) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'INVALID_TIMESTAMP' };
  // Reject requests from too far in the past AND the future (clock skew or forged timestamps).
  if (Math.abs(nowSeconds - Number(timestamp)) > tolerance) return { ok: false, reason: 'EXPIRED' };

  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody), 'hex');
  const received = Buffer.from(signature, 'hex');
  // timingSafeEqual throws on different lengths, so check the length first.
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  return { ok: true };
}
