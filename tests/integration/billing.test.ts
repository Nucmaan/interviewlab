import { runBillingCycle } from '@ircub/worker/jobs/billing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { baseFixtures, resetDatabase, testContext } from './helpers';

const ctx = testContext();
const MONTH = new Date('2026-03-01T00:00:00Z');

/** Readings for Dec, Jan, Feb (10 m³ each), then the March reading under test. */
async function account(payerId: number, n: number, marchReading: number | null) {
  const accountNo = `WA-${String(n).padStart(6, '0')}`;
  const meterNo = `MTR-T${n}`;
  await ctx.prisma.waterAccount.create({
    data: {
      account_no: accountNo,
      payer_id: payerId,
      meter_no: meterNo,
      tariff_class: 'DOMESTIC',
      created_at: new Date('2025-11-01'),
    },
  });
  const readings: [string, number, number][] = [
    ['2025-11-25', 1000, 0],
    ['2025-12-25', 1010, 10],
    ['2026-01-25', 1020, 10],
    ['2026-02-25', 1030, 10],
  ];
  if (marchReading !== null) readings.push(['2026-03-25', 1030 + marchReading, marchReading]);
  await ctx.prisma.meterReading.createMany({
    data: readings.map(([date, value, consumption]) => ({
      meter_no: meterNo,
      reading_date: new Date(`${date}T00:00:00Z`),
      reading_value: value,
      reading_type: 'ACTUAL' as const,
      consumption_m3: consumption,
    })),
  });
  return accountNo;
}

describe('monthly billing cycle', () => {
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    const { payerId } = await baseFixtures(ctx.prisma);
    await ctx.prisma.tariff.create({
      data: {
        tariff_class: 'DOMESTIC',
        name: 'Domestic',
        service_charge: 200,
        effective_from: new Date('2024-01-01'),
        bands: {
          create: [
            { sort_order: 1, up_to_m3: 10, rate_per_m3: 50 },
            { sort_order: 2, up_to_m3: 30, rate_per_m3: 75 },
            { sort_order: 3, up_to_m3: null, rate_per_m3: 110 },
          ],
        },
      },
    });
    await account(payerId, 1, 11); // normal: 11 m³ -> 775
    await account(payerId, 2, 31); // 31 m³ is > 200% of the 10 m³ average -> held
    await account(payerId, 3, null); // no March reading -> estimated from history (10 m³)
    // Account 1 owes 1000 from February and paid 400 of it.
    await ctx.prisma.waterBill.create({
      data: {
        account_no: 'WA-000001',
        billing_month: new Date('2026-02-01T00:00:00Z'),
        consumption_m3: 10,
        consumption_charge: 800,
        service_charge: 200,
        amount_billed: 1000,
        total_due: 1000,
        amount_paid: 400,
        due_date: new Date('2026-03-21'),
        status: 'PART_PAID',
        control_number: 'WB-2026-0000001-0',
      },
    });
  });
  afterAll(async () => {
    await ctx.prisma.$disconnect();
    ctx.redis.disconnect();
  });

  it('applies the tariff, carries arrears forward, estimates and holds abnormal bills', async () => {
    const cycle = await ctx.prisma.billingCycle.create({ data: { billing_month: MONTH } });
    await runBillingCycle(ctx, cycle.cycle_id);

    const bills = await ctx.prisma.waterBill.findMany({
      where: { billing_month: MONTH },
      orderBy: { account_no: 'asc' },
    });
    const [normal, abnormal, estimated] = bills;
    expect(Number(normal!.amount_billed)).toBe(775);
    expect(Number(normal!.arrears_brought_forward)).toBe(600); // 1000 - 400 paid
    expect(Number(normal!.total_due)).toBe(1375);
    expect(normal!.status).toBe('ISSUED');

    expect(abnormal!.status).toBe('HELD');
    expect(abnormal!.is_abnormal).toBe(true);

    expect(estimated!.is_estimated).toBe(true);
    expect(estimated!.consumption_m3).toBe(10);
    expect(Number(estimated!.amount_billed)).toBe(700);

    const previous = await ctx.prisma.waterBill.findUniqueOrThrow({
      where: { control_number: 'WB-2026-0000001-0' },
    });
    expect(previous.status).toBe('CARRIED_FORWARD');

    const done = await ctx.prisma.billingCycle.findUniqueOrThrow({
      where: { cycle_id: cycle.cycle_id },
    });
    expect(done).toMatchObject({ status: 'COMPLETED', bills_created: 3, bills_held: 1 });
    const types = (done.exceptions as { type: string }[]).map((e) => e.type).sort();
    expect(types).toEqual(['ABNORMAL', 'ESTIMATED']);
  });

  it('is safe to re-run: no account is billed twice', async () => {
    const cycle = await ctx.prisma.billingCycle.create({ data: { billing_month: MONTH } });
    await runBillingCycle(ctx, cycle.cycle_id);
    await runBillingCycle(ctx, cycle.cycle_id);
    expect(await ctx.prisma.waterBill.count({ where: { billing_month: MONTH } })).toBe(3);
  });
});
