/**
 * Redis connections. BullMQ needs `maxRetriesPerRequest: null` so a blocking worker connection
 * waits for Redis to come back instead of throwing during a short outage.
 */
import { Redis } from 'ioredis';

export { Redis };

export function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

const globalForRedis = globalThis as unknown as { __ircubRedis?: Redis };

/** Shared connection for commands (cache, publishing, enqueueing). Not for SUBSCRIBE. */
export function getRedis(): Redis {
  globalForRedis.__ircubRedis ??= createRedis();
  return globalForRedis.__ircubRedis;
}
