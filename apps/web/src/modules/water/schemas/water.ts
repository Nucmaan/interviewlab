import { z } from 'zod';

export const READING_FLAGS = ['NORMAL', 'ROLLOVER', 'METER_REPLACEMENT'] as const;

export const readingSchema = z.object({
  accountNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^WA-\d{6}$/, 'Account number looks like WA-000123'),
  readingDate: z.iso.date('Use the date format YYYY-MM-DD'),
  readingValue: z.coerce.number().int('Whole m³ only').min(0).max(999_999_999),
  readingFlag: z.enum(READING_FLAGS).default('NORMAL'),
});
export type ReadingInput = z.infer<typeof readingSchema>;

/** CSV columns: account_no, reading_date, reading_value, reading_flag (optional) */
export const readingCsvRowSchema = z
  .object({
    account_no: z.string(),
    reading_date: z.string(),
    reading_value: z.string(),
    reading_flag: z.string().optional(),
  })
  .transform((r) => ({
    accountNo: r.account_no,
    readingDate: r.reading_date.trim(),
    readingValue: r.reading_value,
    readingFlag: r.reading_flag?.trim().toUpperCase() || 'NORMAL',
  }));

export const runCycleSchema = z.object({
  billingMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month'),
});

export const releaseBillSchema = z.object({ billId: z.coerce.number().int().positive() });

export const tariffBandsSchema = z.object({
  tariffId: z.coerce.number().int().positive(),
  serviceCharge: z.coerce.number().min(0),
  /** One band per line: "up_to_m3:rate", with "*" meaning no upper limit, e.g. "10:50\n30:75\n*:110" */
  bands: z.string().min(1),
});
