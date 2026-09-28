import { runPenalties } from '@ircub/worker/jobs/penalties';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { baseFixtures, resetDatabase, testContext } from './helpers';

const ctx = testContext();
const RUN_DATE = '2026-06-15';

async function createAssessments(payerId: number) {
  const rows = [
    // [amount_due, amount_paid, due_date]
    [1000, 0, '2026-05-01'], // 1 month  -> 50
    [1000, 0, '2026-02-10'], // 4 months -> 3x5% + 1x10% = 250
    [1000, 400, '2025-12-01'], // 6 months on 600 unpaid -> 45% of 600 = 270
    [1000, 0, '2025-01-01'], // 17 months -> 155% -> capped at 1000
    [1000, 0, '2026-06-01'], // not a full month yet -> 0
    [333.33, 0, '2026-03-15'], // 3 months -> 15% = 50.00 (rounding)
  ] as const;
  let n = 0;
  for (const [due, paid, date] of rows) {
    await ctx.prisma.assessment.create({
      data: {
        payer_id: payerId,
        revenue_code: 'BL',
        amount_due: due,
        amount_paid: paid,
        due_date: new Date(`${date}T00:00:00Z`),
        status: paid > 0 ? 'PART_PAID' : 'OPEN',
        control_number: `AS-2026-${String(++n).padStart(7, '0')}-0`,
      },
    });
  }
}

const penalties = async () =>
  (await ctx.prisma.assessment.findMany({ orderBy: { assessment_id: 'asc' } })).map((a) =>
    Number(a.penalty_amount),
  );

describe('overdue penalty routine', () => {
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    const { payerId } = await baseFixtures(ctx.prisma);
    await createAssessments(payerId);
  });
  afterAll(async () => {
    await ctx.prisma.$disconnect();
    ctx.redis.disconnect();
  });

  it("the SQL function applies the brief's rules", async () => {
    await ctx.prisma.$queryRaw`SELECT * FROM apply_overdue_penalties(${RUN_DATE}::date)`;
    expect(await penalties()).toEqual([50, 250, 270, 1000, 0, 50]);
  });

  it('the SQL function is idempotent: a second run on the same day changes nothing', async () => {
    const [first] = await ctx.prisma.$queryRaw<
      { assessments_updated: number; history_rows_inserted: number }[]
    >`
      SELECT * FROM apply_overdue_penalties(${RUN_DATE}::date)`;
    const [second] = await ctx.prisma.$queryRaw<
      { assessments_updated: number; history_rows_inserted: number }[]
    >`
      SELECT * FROM apply_overdue_penalties(${RUN_DATE}::date)`;
    expect(first).toEqual({ assessments_updated: 5, history_rows_inserted: 5 });
    expect(second).toEqual({ assessments_updated: 0, history_rows_inserted: 0 });
    expect(await penalties()).toEqual([50, 250, 270, 1000, 0, 50]);
    expect(await ctx.prisma.penaltyHistory.count()).toBe(5);
  });

  it('the TypeScript job gives exactly the same results and is idempotent too', async () => {
    const first = await runPenalties(ctx, new Date(`${RUN_DATE}T12:00:00Z`));
    const tsResults = await penalties();
    const second = await runPenalties(ctx, new Date(`${RUN_DATE}T18:00:00Z`));
    expect(tsResults).toEqual([50, 250, 270, 1000, 0, 50]);
    expect(first.updated).toBe(5);
    expect(second).toMatchObject({ updated: 0, historyRows: 0 });
  });

  it('never lowers a penalty after the principal is paid', async () => {
    await ctx.prisma.$queryRaw`SELECT * FROM apply_overdue_penalties(${RUN_DATE}::date)`;
    const target = (
      await ctx.prisma.assessment.findMany({ orderBy: { assessment_id: 'asc' } })
    )[1]!;
    await ctx.prisma.assessment.update({
      where: { assessment_id: target.assessment_id },
      data: { amount_paid: 1000, status: 'PART_PAID' },
    });
    await ctx.prisma.$queryRaw`SELECT * FROM apply_overdue_penalties('2026-07-20'::date)`;
    await runPenalties(ctx, new Date('2026-08-20T00:00:00Z'));
    const after = await ctx.prisma.assessment.findUniqueOrThrow({
      where: { assessment_id: target.assessment_id },
    });
    expect(Number(after.penalty_amount)).toBe(250);
  });
});
