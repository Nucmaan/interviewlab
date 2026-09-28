import { z } from 'zod';
import { moneySchema, paymentRecordSchema } from '@/modules/payments/schemas/payment';

export const revenueTypeSchema = z.object({
  revenueCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, 'Use 2-20 capital letters, numbers or underscores'),
  name: z.string().trim().min(3).max(100),
  category: z.enum(['TAX', 'WATER']),
  glCode: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{3}$/, 'GL code format is NNNN-NNN, e.g. 1410-100'),
  defaultAmount: z.coerce.number().positive().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true'),
  description: z.string().trim().max(300).optional(),
});

const isoDate = z.iso.date('Use the date format YYYY-MM-DD');

export const assessmentSchema = z.object({
  tin: z
    .string()
    .trim()
    .regex(/^\d{9,12}$/, 'TIN must be 9 to 12 digits'),
  revenueCode: z.string().trim().min(1, 'Choose a revenue type'),
  amountDue: z.coerce.number().pipe(moneySchema),
  dueDate: isoDate,
  period: z.string().trim().max(30).optional(),
  description: z.string().trim().max(200).optional(),
});
export type AssessmentInput = z.infer<typeof assessmentSchema>;

/**
 * CSV rows arrive as strings. Each row is first converted (numbers, dates), then validated with
 * exactly the same schema as the JSON API / form. This runs in the browser for the live preview
 * AND on the server before anything is saved.
 */
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const paymentCsvConverter = z.object({
  payer_id: z.preprocess(emptyToUndefined, z.coerce.number()),
  revenue_code: z.string(),
  amount: z.preprocess(emptyToUndefined, z.coerce.number()),
  currency: z.string().trim().toUpperCase(),
  channel: z.string().trim().toUpperCase(),
  external_ref: z.string(),
  // Accept a plain date (YYYY-MM-DD) as well as a full timestamp.
  paid_at: z
    .string()
    .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? `${v.trim()}T00:00:00Z` : v.trim())),
  assessment_id: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
  bill_id: z.preprocess(emptyToUndefined, z.coerce.number().optional()),
});

const assessmentCsvConverter = z
  .object({
    tin: z.string(),
    revenue_code: z.string(),
    amount_due: z.string(),
    due_date: z.string(),
    period: z.preprocess(emptyToUndefined, z.string().optional()),
    description: z.preprocess(emptyToUndefined, z.string().optional()),
  })
  .transform((r) => ({
    tin: r.tin,
    revenueCode: r.revenue_code,
    amountDue: r.amount_due,
    dueDate: r.due_date.trim(),
    period: r.period,
    description: r.description,
  }));

function convertThenValidate<T>(
  converter: z.ZodType,
  schema: z.ZodType<T>,
  raw: Record<string, string>,
): z.ZodSafeParseResult<T> {
  const converted = converter.safeParse(raw);
  return converted.success
    ? schema.safeParse(converted.data)
    : (converted as z.ZodSafeParseResult<T>);
}

/** Converted values (numbers, dates) when possible, otherwise the raw row - for error reporting. */
export function convertPaymentCsvRow(raw: Record<string, string>): unknown {
  const converted = paymentCsvConverter.safeParse(raw);
  return converted.success ? converted.data : raw;
}

export const parsePaymentCsvRow = (raw: Record<string, string>) =>
  convertThenValidate(paymentCsvConverter, paymentRecordSchema, raw);

export const parseAssessmentCsvRow = (raw: Record<string, string>) =>
  convertThenValidate(assessmentCsvConverter, assessmentSchema, raw);

export const CSV_TEMPLATES = {
  payments: {
    columns: [
      'payer_id',
      'revenue_code',
      'amount',
      'currency',
      'channel',
      'external_ref',
      'paid_at',
      'assessment_id',
      'bill_id',
    ],
    example: '12,BL,150.50,USD,BANK,BNK-20260928-900001,2026-09-28,,',
  },
  assessments: {
    columns: ['tin', 'revenue_code', 'amount_due', 'due_date', 'period', 'description'],
    example: '2001000012,PR,90000,2026-11-15,2026-Q4,Quarterly property rate',
  },
} as const;

export type CsvKind = keyof typeof CSV_TEMPLATES;

export const MAX_CSV_ROWS = 10_000;
