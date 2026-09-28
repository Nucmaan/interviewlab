import { describe, expect, it } from 'vitest';
import { computeSignature, verifySignature } from './hmac';

const secret = 'test-secret';
const body = '{"external_ref":"MM-1","amount":100}';
const now = 1_800_000_000;
const ts = String(now);

describe('verifySignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const signature = computeSignature(secret, ts, body);
    expect(
      verifySignature({ secret, timestamp: ts, signature, rawBody: body, nowSeconds: now }),
    ).toEqual({ ok: true });
  });

  it('rejects a tampered body', () => {
    const signature = computeSignature(secret, ts, body);
    const result = verifySignature({
      secret,
      timestamp: ts,
      signature,
      rawBody: body.replace('100', '900'),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a signature made with another secret', () => {
    const signature = computeSignature('wrong', ts, body);
    expect(
      verifySignature({ secret, timestamp: ts, signature, rawBody: body, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a request older than 5 minutes (replay)', () => {
    const oldTs = String(now - 301);
    const signature = computeSignature(secret, oldTs, body);
    expect(
      verifySignature({ secret, timestamp: oldTs, signature, rawBody: body, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('accepts a request exactly at the 5 minute limit', () => {
    const edgeTs = String(now - 300);
    const signature = computeSignature(secret, edgeTs, body);
    expect(
      verifySignature({ secret, timestamp: edgeTs, signature, rawBody: body, nowSeconds: now }).ok,
    ).toBe(true);
  });

  it('rejects missing headers and malformed values', () => {
    expect(
      verifySignature({ secret, timestamp: null, signature: 'ab', rawBody: body, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'MISSING_HEADERS' });
    expect(
      verifySignature({
        secret,
        timestamp: 'abc',
        signature: 'ab',
        rawBody: body,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'INVALID_TIMESTAMP' });
    expect(
      verifySignature({ secret, timestamp: ts, signature: 'zz', rawBody: body, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });
});
