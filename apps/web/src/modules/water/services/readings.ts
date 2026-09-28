import 'server-only';
import { calculateConsumption, InvalidReadingError } from '@ircub/core';
import Papa from 'papaparse';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import type { CurrentUser } from '@/lib/rbac';
import { readingCsvRowSchema, readingSchema, type ReadingInput } from '../schemas/water';

/**
 * Accepts one meter reading. Consumption is worked out against the previous reading by
 * calculateConsumption (core), which rejects a LOWER reading unless it is flagged as a rollover
 * or a meter replacement.
 */
export async function captureReading(input: ReadingInput, user: CurrentUser) {
  const account = await prisma.waterAccount.findUnique({ where: { account_no: input.accountNo } });
  if (!account) throw new NotFoundError(`Water account ${input.accountNo}`);
  const readingDate = new Date(`${input.readingDate}T00:00:00Z`);
  if (readingDate.getTime() > Date.now())
    throw new DomainError('A reading cannot be in the future');

  return prisma.$transaction(async (tx) => {
    const previous = await tx.meterReading.findFirst({
      where: { meter_no: account.meter_no, reading_date: { lt: readingDate } },
      orderBy: { reading_date: 'desc' },
    });
    const later = await tx.meterReading.findFirst({
      where: { meter_no: account.meter_no, reading_date: { gte: readingDate } },
    });
    if (later)
      throw new DomainError(
        `There is already a reading on or after ${input.readingDate} for this meter`,
      );

    const consumption = previous
      ? calculateConsumption(previous.reading_value, input.readingValue, {
          meterDigits: account.meter_digits,
          flag: input.readingFlag,
        })
      : 0; // the first reading of a new meter is its starting point
    const reading = await tx.meterReading.create({
      data: {
        meter_no: account.meter_no,
        reading_date: readingDate,
        reading_value: input.readingValue,
        reading_type: 'ACTUAL',
        reading_flag: input.readingFlag,
        consumption_m3: consumption,
        captured_by: user.userId,
      },
    });
    await audit(tx, user, {
      action: 'READING_CAPTURED',
      entityType: 'meter_reading',
      entityId: reading.reading_id,
      after: { ...input, previous: previous?.reading_value ?? null, consumption },
    });
    return { readingId: reading.reading_id, consumption };
  });
}

export interface ReadingUploadReport {
  totalRows: number;
  accepted: number;
  rejected: number;
  errors: { row: number; reason: string }[];
}

/** CSV readings: each row is validated and saved on its own; failures are listed in the report. */
export async function uploadReadings(csv: string, user: CurrentUser): Promise<ReadingUploadReport> {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (
    !parsed.meta.fields?.includes('account_no') ||
    !parsed.meta.fields.includes('reading_value')
  ) {
    throw new DomainError(
      'The file needs the columns account_no, reading_date, reading_value (and optionally reading_flag)',
    );
  }
  if (parsed.data.length > 10_000) throw new DomainError('At most 10,000 rows per file');

  const errors: { row: number; reason: string }[] = [];
  let accepted = 0;
  for (const [index, raw] of parsed.data.entries()) {
    const row = index + 1;
    const shaped = readingCsvRowSchema.safeParse(raw);
    const input = shaped.success ? readingSchema.safeParse(shaped.data) : shaped;
    if (!input.success) {
      const issue = input.error.issues[0];
      errors.push({
        row,
        reason: `${issue?.path.join('.') || 'row'}: ${issue?.message ?? 'invalid'}`,
      });
      continue;
    }
    try {
      await captureReading(input.data as ReadingInput, user);
      accepted++;
    } catch (error) {
      if (error instanceof DomainError || error instanceof InvalidReadingError) {
        errors.push({ row, reason: error.message });
      } else {
        throw error;
      }
    }
  }
  return { totalRows: parsed.data.length, accepted, rejected: errors.length, errors };
}
