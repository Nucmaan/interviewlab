/**
 * Monthly water billing cycle (POC module 4).
 *
 * For every active account:
 *   1. Consumption for the month: the actual reading, or - if there is none - an estimate from the
 *      last 3 actual readings (core estimateConsumption). No history at all -> exception, no bill.
 *   2. Abnormal consumption (> threshold % of the 3-month average) -> the bill is created HELD and is
 *      not sent until an officer releases it.
 *   3. Charges from the tiered tariff loaded from the tariff tables (core calculateWaterBill).
 *   4. Arrears carried forward: previous bill's total due minus what was paid against it
 *      (core composeBill); the previous bill becomes CARRIED_FORWARD.
 *   5. Issued bills get an SMS / email notification (mock gateway).
 *
 * Re-running a cycle is safe: UNIQUE(account_no, billing_month) and a "bill exists" check mean an
 * account is never billed twice for the same month.
 */
import {
  calculateWaterBill,
  composeBill,
  estimateConsumption,
  generateControlNumber,
  isAbnormalConsumption,
  type TariffConfig,
} from '@ircub/core';
import { getConfig, recordAudit, toNumber, type TariffClass } from '@ircub/db';
import { publishEvent } from '@ircub/platform';
import type { WorkerContext } from '../lib/context';
import { queueNotification } from './notifications';

export interface BillingException {
  accountNo: string;
  type: 'ESTIMATED' | 'ABNORMAL' | 'NO_READING' | 'ZERO_CONSUMPTION' | 'ERROR';
  message: string;
}

const DAY_MS = 86_400_000;

async function loadTariffs(
  ctx: WorkerContext,
  monthStart: Date,
): Promise<Map<TariffClass, TariffConfig>> {
  const tariffs = await ctx.prisma.tariff.findMany({
    where: { is_active: true, effective_from: { lte: monthStart } },
    orderBy: { effective_from: 'desc' },
    include: { bands: { orderBy: { sort_order: 'asc' } } },
  });
  const byClass = new Map<TariffClass, TariffConfig>();
  // Newest effective tariff per class wins (list is ordered newest first).
  for (const t of tariffs) {
    if (byClass.has(t.tariff_class)) continue;
    byClass.set(t.tariff_class, {
      serviceCharge: toNumber(t.service_charge),
      bands: t.bands.map((b) => ({ upToM3: b.up_to_m3, ratePerM3: toNumber(b.rate_per_m3) })),
    });
  }
  return byClass;
}

export async function runBillingCycle(ctx: WorkerContext, cycleId: number): Promise<void> {
  const cycle = await ctx.prisma.billingCycle.findUniqueOrThrow({ where: { cycle_id: cycleId } });
  const monthStart = cycle.billing_month;
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const lastDay = new Date(monthEnd.getTime() - DAY_MS);
  const monthLabel = monthStart.toISOString().slice(0, 7);

  try {
    const [tariffs, thresholdPct, dueDays] = await Promise.all([
      loadTariffs(ctx, monthStart),
      getConfig(ctx.prisma, 'abnormal_consumption_threshold_pct', 200),
      getConfig(ctx.prisma, 'bill_due_days', 21),
    ]);
    const accounts = await ctx.prisma.waterAccount.findMany({
      where: { status: 'ACTIVE', created_at: { lt: monthEnd } },
      include: { payer: { select: { phone: true, email: true, full_name: true } } },
      orderBy: { account_no: 'asc' },
    });

    const exceptions: BillingException[] = [];
    let created = 0;
    let held = 0;

    for (const account of accounts) {
      try {
        const existing = await ctx.prisma.waterBill.findUnique({
          where: {
            account_no_billing_month: { account_no: account.account_no, billing_month: monthStart },
          },
        });
        if (existing) continue;

        const tariff = tariffs.get(account.tariff_class);
        if (!tariff) throw new Error(`No active tariff for ${account.tariff_class}`);

        const [reading, history] = await Promise.all([
          ctx.prisma.meterReading.findFirst({
            where: { meter_no: account.meter_no, reading_date: { gte: monthStart, lt: monthEnd } },
            orderBy: { reading_date: 'desc' },
          }),
          ctx.prisma.meterReading.findMany({
            where: { meter_no: account.meter_no, reading_date: { lt: monthStart } },
            orderBy: { reading_date: 'desc' },
            take: 6,
          }),
        ]);
        // The very first reading of a meter is its starting value, not a month of usage.
        const isFirstEverReading = (index: number) =>
          history.length < 6 && index === history.length - 1;
        const usage = history.filter((_, index) => !isFirstEverReading(index));

        let readingId: number;
        let consumption: number;
        let estimated = false;
        if (reading) {
          readingId = reading.reading_id;
          consumption = reading.consumption_m3;
        } else {
          const estimate = estimateConsumption(
            usage.map((h) => ({ consumptionM3: h.consumption_m3, readingType: h.reading_type })),
          );
          if (estimate === null) {
            exceptions.push({
              accountNo: account.account_no,
              type: 'NO_READING',
              message: 'No reading and no actual history to estimate from',
            });
            continue;
          }
          const previousValue = history[0]?.reading_value ?? 0;
          const capacity = 10 ** account.meter_digits;
          const value = (previousValue + estimate) % capacity;
          const est = await ctx.prisma.meterReading.create({
            data: {
              meter_no: account.meter_no,
              reading_date: lastDay,
              reading_value: value,
              reading_type: 'ESTIMATED',
              reading_flag: previousValue + estimate >= capacity ? 'ROLLOVER' : 'NORMAL',
              consumption_m3: estimate,
            },
          });
          readingId = est.reading_id;
          consumption = estimate;
          estimated = true;
          exceptions.push({
            accountNo: account.account_no,
            type: 'ESTIMATED',
            message: `Estimated ${estimate} m³ from the last actual readings`,
          });
        }

        const previousMonths = usage
          .filter((h) => h.reading_type === 'ACTUAL')
          .map((h) => h.consumption_m3);
        const abnormal =
          !estimated && isAbnormalConsumption(consumption, previousMonths, thresholdPct);
        if (abnormal) {
          const avg =
            previousMonths.slice(0, 3).reduce((s, v) => s + v, 0) /
            Math.max(1, Math.min(3, previousMonths.length));
          exceptions.push({
            accountNo: account.account_no,
            type: 'ABNORMAL',
            message: `${consumption} m³ is more than ${thresholdPct}% of the 3-month average (${avg.toFixed(1)} m³) - held for investigation`,
          });
        }
        if (consumption === 0) {
          exceptions.push({
            accountNo: account.account_no,
            type: 'ZERO_CONSUMPTION',
            message: 'Zero consumption - check the meter',
          });
        }

        const charges = calculateWaterBill(consumption, tariff);
        const previousBill = await ctx.prisma.waterBill.findFirst({
          where: {
            account_no: account.account_no,
            billing_month: { lt: monthStart },
            status: { notIn: ['CANCELLED'] },
          },
          orderBy: { billing_month: 'desc' },
        });
        const composition = composeBill({
          previousBalance: previousBill ? toNumber(previousBill.total_due) : 0,
          paymentsReceived: previousBill ? toNumber(previousBill.amount_paid) : 0,
          currentCharges: charges.total,
        });

        const bill = await ctx.prisma.$transaction(async (tx) => {
          const [seq] = await tx.$queryRaw<
            { seq: bigint }[]
          >`SELECT nextval('bill_control_seq') AS seq`;
          const b = await tx.waterBill.create({
            data: {
              account_no: account.account_no,
              billing_month: monthStart,
              cycle_id: cycleId,
              reading_id: readingId,
              consumption_m3: consumption,
              is_estimated: estimated,
              consumption_charge: charges.consumptionCharge,
              service_charge: charges.serviceCharge,
              amount_billed: charges.total,
              previous_balance: composition.previousBalance,
              payments_received: composition.paymentsReceived,
              arrears_brought_forward: composition.arrearsBroughtForward,
              total_due: composition.totalDue,
              amount_paid: 0,
              due_date: new Date(lastDay.getTime() + dueDays * DAY_MS),
              status: abnormal ? 'HELD' : composition.totalDue <= 0 ? 'PAID' : 'ISSUED',
              is_abnormal: abnormal,
              hold_reason: abnormal ? 'Abnormal consumption' : null,
              control_number: generateControlNumber(
                'WB',
                new Date().getUTCFullYear(),
                Number(seq!.seq),
              ),
            },
          });
          if (previousBill && previousBill.status !== 'PAID') {
            await tx.waterBill.update({
              where: { bill_id: previousBill.bill_id },
              data: { status: 'CARRIED_FORWARD' },
            });
          }
          return b;
        });
        created++;
        if (abnormal) held++;
        else await notifyBillIssued(ctx, bill.bill_id);
      } catch (error) {
        exceptions.push({
          accountNo: account.account_no,
          type: 'ERROR',
          message: (error as Error).message.slice(0, 200),
        });
        ctx.logger.error(
          { err: error, accountNo: account.account_no },
          'billing failed for account',
        );
      }
    }

    // A re-run only bills accounts that were missed, so totals are counted from the database and
    // the exceptions of earlier runs are kept in the report.
    const previousExceptions = Array.isArray(cycle.exceptions)
      ? (cycle.exceptions as unknown as BillingException[])
      : [];
    const [billsInCycle, heldInCycle] = await Promise.all([
      ctx.prisma.waterBill.count({ where: { cycle_id: cycleId } }),
      ctx.prisma.waterBill.count({ where: { cycle_id: cycleId, status: 'HELD' } }),
    ]);
    await ctx.prisma.$transaction(async (tx) => {
      await tx.billingCycle.update({
        where: { cycle_id: cycleId },
        data: {
          status: 'COMPLETED',
          bills_created: billsInCycle,
          bills_held: heldInCycle,
          exceptions: [...previousExceptions, ...exceptions] as object[],
          completed_at: new Date(),
        },
      });
      await recordAudit(tx, {
        actorUserId: cycle.run_by,
        action: 'BILLING_CYCLE_COMPLETED',
        entityType: 'billing_cycle',
        entityId: cycleId,
        after: { month: monthLabel, created, held, exceptions: exceptions.length },
      });
    });
    ctx.logger.info(
      { cycleId, month: monthLabel, created, held, exceptions: exceptions.length },
      'billing cycle completed',
    );
    await publishEvent(ctx.redis, { type: 'billing.cycle', cycleId, status: 'COMPLETED' });
  } catch (error) {
    await ctx.prisma.billingCycle.update({
      where: { cycle_id: cycleId },
      data: {
        status: 'FAILED',
        error: (error as Error).message.slice(0, 500),
        completed_at: new Date(),
      },
    });
    await publishEvent(ctx.redis, { type: 'billing.cycle', cycleId, status: 'FAILED' });
    throw error;
  }
}

/** SMS + email with the amount, due date and control number (mock gateway). */
export async function notifyBillIssued(ctx: WorkerContext, billId: number): Promise<void> {
  const bill = await ctx.prisma.waterBill.findUniqueOrThrow({
    where: { bill_id: billId },
    include: { account: { include: { payer: true } } },
  });
  const month = bill.billing_month.toISOString().slice(0, 7);
  const text =
    `IRCUB Water: bill ${month} for ${bill.account_no}: SOS ${toNumber(bill.total_due).toFixed(2)} due ` +
    `${bill.due_date.toISOString().slice(0, 10)}. Pay with reference ${bill.control_number}.`;
  const related = { relatedType: 'water_bill', relatedId: String(billId) };
  if (bill.account.payer.phone)
    await queueNotification(ctx, {
      channel: 'SMS',
      recipient: bill.account.payer.phone,
      body: text,
      ...related,
    });
  if (bill.account.payer.email) {
    await queueNotification(ctx, {
      channel: 'EMAIL',
      recipient: bill.account.payer.email,
      subject: `Your water bill for ${month}`,
      body: `Dear ${bill.account.payer.full_name},\n\n${text}\n\nYou can download the bill from the IRCUB portal.`,
      ...related,
    });
  }
}
