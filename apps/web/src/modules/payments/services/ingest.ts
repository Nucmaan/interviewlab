import 'server-only';
import {
  convertToBase,
  validatePaymentRecords,
  type PaymentRecord,
  type ValidationContext,
} from '@ircub/core';
import type { Prisma, PaymentSource } from '@ircub/db';
import { enqueuePayments } from '@ircub/platform';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import { paymentRecordSchema, type IngestSummary } from '../schemas/payment';
import { getLatestRates } from './rates';

export interface IngestOptions {
  source: PaymentSource;
  batchRef?: string;
  capturedBy?: number | null;
}

export interface IngestResult extends IngestSummary {
  payments: { row: number; paymentId: number; externalRef: string }[];
}

interface ShapedRow {
  row: number;
  record: PaymentRecord;
  raw: unknown;
}

/**
 * The single entry point for new payments, used by the bank/mobile money callback, the bulk API,
 * the CSV uploader and the counter capture form (Part 1 "Data Validation & Concurrency").
 *
 *  1. Shape check with Zod (types, required fields) - per row, so one bad row does not fail all.
 *  2. Business rules in @ircub/core (amount > 0, payer exists, revenue code valid and active,
 *     external_ref unique) using reference data loaded in a handful of bulk queries.
 *  3. Valid rows -> `payment` (status PENDING); rejected rows -> `rejected_payment` with the reason.
 *     Both are written in one transaction.
 *  4. Valid payments are queued for the worker pool (one queue per revenue category).
 */
export async function ingestPayments(
  rows: readonly unknown[],
  options: IngestOptions,
): Promise<IngestResult> {
  const errors: { row: number; reason: string; raw: unknown; externalRef?: string }[] = [];
  const shaped: ShapedRow[] = [];

  rows.forEach((raw, index) => {
    const parsed = paymentRecordSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      errors.push({
        row: index + 1,
        reason: `${issue?.path.join('.') || 'row'}: ${issue?.message ?? 'invalid'}`,
        raw,
      });
      return;
    }
    const r = parsed.data;
    shaped.push({
      row: index + 1,
      raw,
      record: {
        payerId: r.payer_id,
        revenueCode: r.revenue_code,
        amount: r.amount,
        currency: r.currency,
        channel: r.channel,
        externalRef: r.external_ref,
        paidAt: new Date(r.paid_at),
        assessmentId: r.assessment_id ?? null,
        billId: r.bill_id ?? null,
      },
    });
  });

  const context = await loadValidationContext(shaped.map((s) => s.record));
  const validation = validatePaymentRecords(
    shaped.map((s) => s.record),
    context,
  );
  for (const rejected of validation.rejected) {
    const source = shaped[rejected.row - 1]!;
    errors.push({
      row: source.row,
      reason: rejected.reason,
      raw: source.raw,
      externalRef: source.record.externalRef,
    });
  }

  // Convert to the base currency with the latest stored rate.
  const rates = await getLatestRates();
  const toInsert: {
    row: number;
    data: Prisma.PaymentCreateManyInput;
    category: 'TAX' | 'WATER';
  }[] = [];
  for (const valid of validation.valid) {
    const { record } = valid;
    const source = shaped[valid.row - 1]!;
    const rate = rates.get(record.currency);
    if (!rate) {
      errors.push({
        row: source.row,
        reason: `No exchange rate available for ${record.currency}`,
        raw: source.raw,
      });
      continue;
    }
    toInsert.push({
      row: source.row,
      category: context.categories.get(record.revenueCode) ?? 'TAX',
      data: {
        payer_id: record.payerId,
        revenue_code: record.revenueCode,
        assessment_id: record.assessmentId ?? null,
        bill_id: record.billId ?? null,
        amount: record.amount,
        currency: record.currency,
        exchange_rate: rate,
        amount_base: convertToBase(record.amount, record.currency, rate),
        channel: record.channel,
        external_ref: record.externalRef.trim(),
        paid_at: record.paidAt,
        status: 'PENDING',
        source: options.source,
        captured_by: options.capturedBy ?? null,
      },
    });
  }

  const inserted = await prisma.$transaction(async (tx) => {
    // skipDuplicates = ON CONFLICT DO NOTHING. If another request inserted the same external_ref
    // a moment ago (after our validation read), the UNIQUE constraint wins and the row is skipped
    // instead of failing the whole batch.
    const created = await tx.payment.createManyAndReturn({
      data: toInsert.map((p) => p.data),
      skipDuplicates: true,
      select: { payment_id: true, external_ref: true },
    });
    const createdRefs = new Set(created.map((c) => c.external_ref));
    for (const p of toInsert) {
      if (!createdRefs.has(p.data.external_ref)) {
        errors.push({
          row: p.row,
          reason: `Duplicate external reference ${p.data.external_ref} (received concurrently)`,
          raw: shaped[p.row - 1]?.raw ?? null,
        });
      }
    }
    if (errors.length > 0) {
      await tx.rejectedPayment.createMany({
        data: errors.map((e) => ({
          source: options.source,
          batch_ref: options.batchRef ?? null,
          row_number: e.row,
          external_ref: e.externalRef ?? extractRef(e.raw),
          payload: (e.raw ?? {}) as Prisma.InputJsonValue,
          reason: e.reason,
        })),
      });
    }
    return created;
  });

  const idByRef = new Map(inserted.map((p) => [p.external_ref, p.payment_id]));
  const payments = toInsert
    .filter((p) => idByRef.has(p.data.external_ref))
    .map((p) => ({
      row: p.row,
      paymentId: idByRef.get(p.data.external_ref)!,
      externalRef: p.data.external_ref,
      category: p.category,
    }));

  try {
    await enqueuePayments(
      redis(),
      payments.map((p) => ({ paymentId: p.paymentId, category: p.category })),
    );
  } catch (error) {
    // The payments are safely stored as PENDING; the worker's sweeper re-queues them.
    logger.error(
      { err: error, count: payments.length },
      'failed to enqueue payments; sweeper will retry',
    );
  }

  const sortedErrors = errors
    .map(({ row, reason }) => ({ row, reason }))
    .sort((a, b) => a.row - b.row);
  logger.info(
    {
      source: options.source,
      batchRef: options.batchRef,
      received: rows.length,
      accepted: payments.length,
      rejected: sortedErrors.length,
    },
    'payments ingested',
  );
  return {
    received: rows.length,
    accepted: payments.length,
    rejected: sortedErrors.length,
    errors: sortedErrors,
    payments: payments.map(({ row, paymentId, externalRef }) => ({ row, paymentId, externalRef })),
  };
}

function extractRef(raw: unknown): string | null {
  if (raw && typeof raw === 'object' && 'external_ref' in raw) {
    const value = (raw as { external_ref: unknown }).external_ref;
    return typeof value === 'string' ? value.slice(0, 64) : null;
  }
  return null;
}

/** Loads everything the validator needs in 5 queries, however many rows there are. */
async function loadValidationContext(
  records: readonly PaymentRecord[],
): Promise<ValidationContext & { categories: Map<string, 'TAX' | 'WATER'> }> {
  const payerIds = [...new Set(records.map((r) => r.payerId))];
  const refs = [...new Set(records.map((r) => r.externalRef.trim()))];
  const assessmentIds = [
    ...new Set(records.flatMap((r) => (r.assessmentId ? [r.assessmentId] : []))),
  ];
  const billIds = [...new Set(records.flatMap((r) => (r.billId ? [r.billId] : [])))];

  const [payers, revenueTypes, existing, assessments, bills] = await Promise.all([
    prisma.payer.findMany({ where: { payer_id: { in: payerIds } }, select: { payer_id: true } }),
    prisma.revenueType.findMany({
      select: { revenue_code: true, is_active: true, category: true },
    }),
    prisma.payment.findMany({
      where: { external_ref: { in: refs } },
      select: { external_ref: true },
    }),
    prisma.assessment.findMany({
      where: { assessment_id: { in: assessmentIds } },
      select: { assessment_id: true, payer_id: true, revenue_code: true },
    }),
    prisma.waterBill.findMany({
      where: { bill_id: { in: billIds } },
      select: { bill_id: true, account: { select: { payer_id: true } } },
    }),
  ]);

  return {
    knownPayerIds: new Set(payers.map((p) => p.payer_id)),
    revenueCodes: new Map(revenueTypes.map((r) => [r.revenue_code, { isActive: r.is_active }])),
    categories: new Map(revenueTypes.map((r) => [r.revenue_code, r.category])),
    existingExternalRefs: new Set(existing.map((e) => e.external_ref)),
    assessments: new Map(
      assessments.map((a) => [
        a.assessment_id,
        { payerId: a.payer_id, revenueCode: a.revenue_code },
      ]),
    ),
    bills: new Map(bills.map((b) => [b.bill_id, { payerId: b.account.payer_id }])),
    now: new Date(),
  };
}
