/**
 * Fixed-window rate limiter in Redis: at most `limit` requests per `windowSeconds` per key
 * (for example per client IP). INCR is atomic, so it is correct across several web instances.
 */
import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function rateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const redisKey = `ratelimit:${key}:${window}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSeconds);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds),
  };
}
