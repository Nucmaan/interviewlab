import 'server-only';
import Papa from 'papaparse';
import { DomainError } from '@/lib/errors';
import type { CurrentUser } from '@/lib/rbac';
import { ingestPayments } from '@/modules/payments/services/ingest';
import {
  CSV_TEMPLATES,
  MAX_CSV_ROWS,
  convertPaymentCsvRow,
  parseAssessmentCsvRow,
  type AssessmentInput,
  type CsvKind,
} from '../schemas/revenue';
import { resolveAssessments, saveAssessments } from './assessments';

export interface UploadReport {
  kind: CsvKind;
  fileName: string;
  totalRows: number;
  accepted: number;
  rejected: number;
  errors: { row: number; reason: string }[];
}

function parseCsv(csv: string, kind: CsvKind): Record<string, string>[] {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new DomainError(`The file could not be read as CSV: ${parsed.errors[0]?.message}`);
  }
  const missing = CSV_TEMPLATES[kind].columns
    .filter((c) => !['assessment_id', 'bill_id', 'period', 'description'].includes(c))
    .filter((c) => !parsed.meta.fields?.includes(c));
  if (missing.length > 0) throw new DomainError(`Missing column(s): ${missing.join(', ')}`);
  if (parsed.data.length === 0) throw new DomainError('The file has no data rows');
  if (parsed.data.length > MAX_CSV_ROWS)
    throw new DomainError(`At most ${MAX_CSV_ROWS} rows per file`);
  return parsed.data;
}

/**
 * Bulk uploader (POC module 3): validate every row BEFORE saving, save the valid rows, and return
 * a report with total / accepted / rejected and the reason for each rejected row.
 * Row numbers in the report are data rows (1 = first row after the header).
 */
export async function processCsvUpload(
  kind: CsvKind,
  fileName: string,
  csv: string,
  user: CurrentUser,
): Promise<UploadReport> {
  const rows = parseCsv(csv, kind);

  if (kind === 'payments') {
    // Convert the strings (numbers, dates); ingestPayments then validates the shape, applies the
    // business rules, stores rejected rows in rejected_payment and queues the valid ones.
    const converted = rows.map(convertPaymentCsvRow);
    const result = await ingestPayments(converted, {
      source: 'CSV_UPLOAD',
      capturedBy: user.userId,
      batchRef: `CSV:${fileName}`.slice(0, 100),
    });
    return {
      kind,
      fileName,
      totalRows: rows.length,
      accepted: result.accepted,
      rejected: result.rejected,
      errors: result.errors,
    };
  }

  const errors: { row: number; reason: string }[] = [];
  const shaped: { row: number; input: AssessmentInput }[] = [];
  rows.forEach((raw, index) => {
    const result = parseAssessmentCsvRow(raw);
    if (result.success) shaped.push({ row: index + 1, input: result.data });
    else {
      const issue = result.error.issues[0];
      errors.push({
        row: index + 1,
        reason: `${issue?.path.join('.') || 'row'}: ${issue?.message ?? 'invalid'}`,
      });
    }
  });
  const resolved = await resolveAssessments(shaped.map((s) => s.input));
  for (const e of resolved.errors) errors.push({ row: shaped[e.row - 1]!.row, reason: e.reason });
  if (resolved.valid.length > 0) await saveAssessments(resolved.valid, user, `csv:${fileName}`);
  return {
    kind,
    fileName,
    totalRows: rows.length,
    accepted: resolved.valid.length,
    rejected: errors.length,
    errors: errors.sort((a, b) => a.row - b.row),
  };
}
