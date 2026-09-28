/**
 * Shared setup for integration tests: a worker context pointed at the TEST database
 * (TEST_DATABASE_URL) and Redis database 1, plus data reset and small fixtures.
 */
import path from 'node:path';
import { createPrismaClient, type PrismaClient } from '@ircub/db';
import { createLogger, Redis } from '@ircub/platform';
import type { WorkerContext } from '@ircub/worker/context';
import { MockServicesClient } from '../../apps/worker/src/lib/mock-services-client';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // CI provides real environment variables.
}

export function testContext(mockUrl = 'http://127.0.0.1:1'): WorkerContext {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url))
    throw new Error('TEST_DATABASE_URL must point at a *_test database');
  // Redis database 1 keeps test keys and queues away from the running demo (database 0).
  const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  redisUrl.pathname = '/1';
  const logger = createLogger('integration-test');
  logger.level = 'silent';
  return {
    prisma: createPrismaClient({ connectionString: url, poolSize: 25 }),
    redis: new Redis(redisUrl.toString(), { maxRetriesPerRequest: null }),
    logger,
    mock: new MockServicesClient(mockUrl, logger),
  };
}

const TABLES = [
  'journal_line',
  'journal_batch',
  'reversal',
  'payment',
  'penalty_history',
  'assessment',
  'water_bill',
  'billing_cycle',
  'meter_reading',
  'water_account',
  'duplicate_flag',
  'payer',
  'rejected_payment',
  'idempotency_key',
  'daily_summary',
  'alert',
  'notification',
  'channel_statement_line',
  'revenue_target',
  'exchange_rate',
  'tariff_band',
  'tariff',
  'revenue_type',
  'system_config',
  'user_role',
  'role_permission',
  'permission',
  'role',
  'app_user',
  'audit_log',
];

/** Empties every table. The audit log's append-only guard is lifted only for this statement. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate'),
    prisma.$executeRawUnsafe(
      `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    ),
    prisma.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate'),
  ]);
}

/** Two revenue types, one payer and the collection bank GL - enough for most tests. */
export async function baseFixtures(prisma: PrismaClient) {
  await prisma.systemConfig.create({ data: { key: 'collection_bank_gl', value: '1101-000' } });
  await prisma.revenueType.createMany({
    data: [
      { revenue_code: 'BL', name: 'Business Licence', category: 'TAX', gl_code: '1410-100' },
      { revenue_code: 'WTR', name: 'Water', category: 'WATER', gl_code: '1510-100' },
    ],
  });
  const payer = await prisma.payer.create({
    data: { payer_type: 'BUSINESS', full_name: 'Test Trading', tin: '2009999001' },
  });
  return { payerId: payer.payer_id };
}

let refSeq = 0;
export const ref = (prefix = 'IT') => `${prefix}-${Date.now()}-${++refSeq}`;
