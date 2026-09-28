import { verifyAuditLog } from '@ircub/db';
import { processPayment } from '@ircub/worker/jobs/process-payment';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { baseFixtures, ref, resetDatabase, testContext } from './helpers';

const ctx = testContext();

describe('parallel payment processing', () => {
  let payerId: number;
  let assessmentId: number;

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ({ payerId } = await baseFixtures(ctx.prisma));
    const a = await ctx.prisma.assessment.create({
      data: {
        payer_id: payerId,
        revenue_code: 'BL',
        amount_due: 1000,
        due_date: new Date('2026-12-31'),
        control_number: 'AS-2026-0000001-0',
      },
    });
    assessmentId = a.assessment_id;
  });
  afterAll(async () => {
    await ctx.prisma.$disconnect();
    ctx.redis.disconnect();
  });

  async function pendingPayments(count: number, amount: number) {
    await ctx.prisma.payment.createMany({
      data: Array.from({ length: count }, () => ({
        payer_id: payerId,
        assessment_id: assessmentId,
        revenue_code: 'BL',
        amount,
        currency: 'SOS' as const,
        amount_base: amount,
        channel: 'BANK' as const,
        external_ref: ref('PAR'),
        paid_at: new Date('2026-03-01T10:00:00Z'),
        source: 'BULK_API' as const,
      })),
    });
    return (await ctx.prisma.payment.findMany({ select: { payment_id: true } })).map(
      (p) => p.payment_id,
    );
  }

  it('processes every payment exactly once when 4 workers race for each one', async () => {
    const ids = await pendingPayments(40, 10);
    // Each payment is handed to 4 concurrent processors (like a job delivered to several workers).
    const outcomes = await Promise.all(
      ids.flatMap((id) => [1, 2, 3, 4].map(() => processPayment(ctx, id))),
    );

    expect(outcomes.filter((o) => o === 'DONE')).toHaveLength(40);
    expect(outcomes.filter((o) => o === 'SKIPPED')).toHaveLength(120);
    const assessment = await ctx.prisma.assessment.findUniqueOrThrow({
      where: { assessment_id: assessmentId },
    });
    expect(Number(assessment.amount_paid)).toBe(400); // 40 x 10, never more
    expect(assessment.status).toBe('PART_PAID');
    expect(await ctx.prisma.payment.count({ where: { status: 'DONE' } })).toBe(40);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'PAYMENT_PROCESSED' } })).toBe(40);
  });

  it('keeps the audit hash chain intact under concurrent writes', async () => {
    const ids = await pendingPayments(25, 1);
    await Promise.all(ids.map((id) => processPayment(ctx, id)));
    expect(await verifyAuditLog(ctx.prisma)).toEqual({ valid: true, checked: 25 });
  });

  it('marks the assessment PAID once payments cover the amount due', async () => {
    const ids = await pendingPayments(2, 500);
    await Promise.all(ids.map((id) => processPayment(ctx, id)));
    const assessment = await ctx.prisma.assessment.findUniqueOrThrow({
      where: { assessment_id: assessmentId },
    });
    expect(assessment.status).toBe('PAID');
  });

  it('a processed payment is never processed again', async () => {
    const [id] = await pendingPayments(1, 100);
    expect(await processPayment(ctx, id!)).toBe('DONE');
    expect(await processPayment(ctx, id!)).toBe('SKIPPED');
  });

  it('the database refuses a second payment with the same external_ref', async () => {
    const externalRef = ref('DUP');
    const data = {
      payer_id: payerId,
      revenue_code: 'BL',
      amount: 1,
      currency: 'SOS' as const,
      amount_base: 1,
      channel: 'BANK' as const,
      external_ref: externalRef,
      paid_at: new Date(),
      source: 'CALLBACK' as const,
    };
    await ctx.prisma.payment.create({ data });
    await expect(ctx.prisma.payment.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });
});
