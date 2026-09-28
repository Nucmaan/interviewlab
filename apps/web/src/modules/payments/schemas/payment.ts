/**
 * Payment schemas shared by the browser (form validation) and the server (API and actions).
 * Using the same schema on both sides means the rules cannot drift apart.
 */
import { z } from 'zod';

export const CURRENCIES = ['USD', 'SOS'] as const;
export const CHANNELS = ['BANK', 'MOBILE_MONEY', 'CASH'] as const;

/** Money with at most 2 decimals (checked with a tolerance: 19.99 * 100 is not exact in JS). */
export const moneySchema = z
  .number({ error: 'Enter an amount' })
  .positive('Amount must be greater than 0')
  .max(1_000_000_000, 'Amount is too large')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places');

export const externalRefSchema = z
  .string()
  .trim()
  .min(3, 'Reference must be at least 3 characters')
  .max(64, 'Reference must be at most 64 characters')
  .regex(/^[A-Za-z0-9._/-]+$/, 'Use letters, numbers, dot, dash, slash or underscore only');

/** One row of POST /api/payments/bulk (snake_case, as bank systems send it). */
export const paymentRecordSchema = z.object({
  payer_id: z.number().int().positive(),
  revenue_code: z.string().trim().min(1).max(20),
  amount: moneySchema,
  currency: z.enum(CURRENCIES),
  channel: z.enum(CHANNELS),
  external_ref: externalRefSchema,
  paid_at: z.iso.datetime({ offset: true }),
  assessment_id: z.number().int().positive().nullish(),
  bill_id: z.number().int().positive().nullish(),
});
export type PaymentRecordInput = z.infer<typeof paymentRecordSchema>;

export const MAX_BULK_ROWS = 10_000;

/** POST /api/payments/callback - a notification from a bank or mobile money provider. */
export const callbackSchema = z.object({
  external_ref: externalRefSchema,
  status: z.enum(['SUCCESS', 'FAILED']),
  amount: moneySchema,
  currency: z.enum(CURRENCIES),
  channel: z.enum(['BANK', 'MOBILE_MONEY']),
  paid_at: z.iso.datetime({ offset: true }),
  /** What the payer paid for: the assessment or bill control number they typed in. */
  control_number: z.string().trim().max(32).optional(),
  provider_ref: z.string().trim().max(64).optional(),
  failure_reason: z.string().trim().max(200).optional(),
});
export type CallbackInput = z.infer<typeof callbackSchema>;

/** The multi-step capture form (Part 1 frontend question). */
export const captureLineSchema = z.object({
  amount: moneySchema,
  currency: z.enum(CURRENCIES),
  channel: z.enum(CHANNELS),
  externalRef: externalRefSchema,
});

export const captureSchema = z
  .object({
    payerId: z.number({ error: 'Select a payer' }).int().positive('Select a payer'),
    revenueCode: z.string().min(1, 'Select a revenue type'),
    assessmentId: z.number().int().positive().nullable(),
    billId: z.number().int().positive().nullable(),
    lines: z
      .array(captureLineSchema)
      .min(1, 'Add at least one payment line')
      .max(10, 'At most 10 lines'),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      const ref = line.externalRef.trim().toUpperCase();
      if (seen.has(ref)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'externalRef'],
          message: 'This reference is already used on another line',
        });
      }
      seen.add(ref);
    });
  });
export type CaptureInput = z.infer<typeof captureSchema>;

/** Standard answer of every payment ingestion endpoint. */
export interface IngestSummary {
  received: number;
  accepted: number;
  rejected: number;
  errors: { row: number; reason: string }[];
}
