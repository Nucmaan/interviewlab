/**
 * Shared dependencies of every job. Jobs receive this object instead of importing globals, which
 * keeps them easy to call from integration tests with a test database.
 */
import { createPrismaClient, type PrismaClient } from '@ircub/db';
import { createLogger, createRedis, type Logger, type Redis } from '@ircub/platform';
import { MockServicesClient } from './mock-services-client';

export interface WorkerContext {
  prisma: PrismaClient;
  /** Commands, publishing and queue producers. */
  redis: Redis;
  logger: Logger;
  mock: MockServicesClient;
}

export function createContext(): WorkerContext {
  const required = ['DATABASE_URL', 'REDIS_URL', 'MOCK_SERVICES_URL'] as const;
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
  const logger = createLogger('worker');
  return {
    prisma: createPrismaClient({ poolSize: Number(process.env.DATABASE_POOL_SIZE ?? 20) }),
    redis: createRedis(),
    logger,
    mock: new MockServicesClient(process.env.MOCK_SERVICES_URL!, logger),
  };
}
