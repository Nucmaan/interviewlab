'use server';

import { createAction } from '@/lib/action';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { captureSchema } from '../schemas/payment';
import { ingestPayments } from '../services/ingest';

/**
 * Step 3 of the capture form. Validated again on the server with the same Zod schema the form
 * used, then passed through the same ingestion pipeline as bank and mobile money payments.
 */
export const capturePaymentsAction = createAction(
  'payments.capture',
  captureSchema,
  async (input, user) => {
    const paidAt = new Date().toISOString();
    const batchRef = `COUNTER-${user.userId}-${Date.now()}`;
    const result = await ingestPayments(
      input.lines.map((line) => ({
        payer_id: input.payerId,
        revenue_code: input.revenueCode,
        amount: line.amount,
        currency: line.currency,
        channel: line.channel,
        external_ref: line.externalRef,
        paid_at: paidAt,
        assessment_id: input.assessmentId,
        bill_id: input.billId,
      })),
      { source: 'COUNTER', capturedBy: user.userId, batchRef },
    );

    await prisma.$transaction((tx) =>
      audit(tx, user, {
        action: 'PAYMENT_CAPTURED',
        entityType: 'payment_batch',
        entityId: batchRef,
        after: {
          payerId: input.payerId,
          revenueCode: input.revenueCode,
          lines: input.lines,
          result,
        },
      }),
    );

    const payer = await prisma.payer.findUniqueOrThrow({
      where: { payer_id: input.payerId },
      select: { full_name: true, tin: true },
    });
    return {
      ...result,
      batchRef,
      paidAt,
      payer: { name: payer.full_name, tin: payer.tin },
      capturedBy: user.fullName,
    };
  },
);
