/**
 * Seeds a fresh database with demo users (one per role), reference data and two years of
 * fictional history. Safe to run on every `docker compose up`: it does nothing if data exists.
 *
 *   pnpm --filter @ircub/db seed
 */
import { createPrismaClient, recordAudit } from '../src/index';
import { loadEnv, log } from './env';
import { seedHistory } from './seed/history';
import {
  DEMO_USERS,
  seedAccessControl,
  seedDemoUsers,
  seedRevenueAndTariffs,
  seedSystemConfig,
} from './seed/reference';

loadEnv();

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    if ((await prisma.role.count()) > 0) {
      log('database already seeded - skipping');
      return;
    }
    const password = process.env.SEED_DEMO_PASSWORD;
    if (!password) throw new Error('SEED_DEMO_PASSWORD is not set');
    const admin = {
      email: (process.env.SEED_ADMIN_EMAIL ?? 'admin@ircub.test').trim().toLowerCase(),
      password: process.env.SEED_ADMIN_PASSWORD ?? password,
    };

    const started = Date.now();
    await seedAccessControl(prisma);
    await seedSystemConfig(prisma);
    await seedRevenueAndTariffs(prisma, new Date(Date.UTC(2024, 0, 1)));
    const users = await seedDemoUsers(prisma, password, admin);
    log(`reference data and ${DEMO_USERS.length} demo users created`);

    const result = await seedHistory(prisma, {
      today: new Date(),
      payerCount: 500,
      waterAccountCount: 460,
      officerId: users.get('officer@ircub.test')!,
      supervisorId: users.get('supervisor@ircub.test')!,
      secondSupervisorId: users.get('supervisor2@ircub.test')!,
    });
    await prisma.user.update({
      where: { email: 'taxpayer@ircub.test' },
      data: { payer_id: result.taxpayerPayerId },
    });
    log(`history created: ${JSON.stringify(result)}`);

    await seedRejectedPayments(prisma);

    // Use the same database functions the worker uses, so seeded data is consistent with them.
    await prisma.$queryRawUnsafe(
      `SELECT refresh_daily_summary((SELECT MIN(paid_at)::date FROM payment), current_date)`,
    );
    const [penalties] = await prisma.$queryRawUnsafe<{ assessments_updated: number }[]>(
      `SELECT * FROM apply_overdue_penalties(current_date)`,
    );
    log(
      `daily summary refreshed; penalties applied to ${penalties?.assessments_updated ?? 0} assessments`,
    );

    await prisma.$transaction((tx) =>
      recordAudit(tx, {
        actorUserId: null,
        action: 'SEED_LOADED',
        entityType: 'system',
        entityId: 'seed',
        after: result,
      }),
    );
    log(`seed finished in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Examples of rejected rows so the "rejected payments" review screen is not empty. */
async function seedRejectedPayments(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  const reasons = [
    'Amount must be greater than 0',
    'Payer 9999 does not exist',
    'Revenue code ROAD is not active',
    'Revenue code XYZ is not valid',
    'Duplicate external reference MM-20260101-000001 (already received)',
  ];
  await prisma.rejectedPayment.createMany({
    data: reasons.flatMap((reason, i) =>
      [0, 1, 2].map((n) => ({
        source:
          n === 0
            ? ('BULK_API' as const)
            : n === 1
              ? ('CSV_UPLOAD' as const)
              : ('CALLBACK' as const),
        batch_ref: `SEED-BATCH-${i + 1}`,
        row_number: n + 1,
        external_ref: `REJ-${i}-${n}`,
        payload: { note: 'seeded example', reason_index: i },
        reason,
        created_at: new Date(Date.now() - (i * 3 + n) * 86_400_000),
      })),
    ),
  });
}

main().catch((error: unknown) => {
  log(`seed failed: ${(error as Error).stack ?? String(error)}`, 'error');
  process.exit(1);
});
