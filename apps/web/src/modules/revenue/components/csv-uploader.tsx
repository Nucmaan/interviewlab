'use client';

import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { Field } from '@/components/field';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { uploadCsvAction } from '../actions/revenue-actions';
import {
  CSV_TEMPLATES,
  MAX_CSV_ROWS,
  parseAssessmentCsvRow,
  parsePaymentCsvRow,
  type CsvKind,
} from '../schemas/revenue';
import type { UploadReport } from '../services/csv-upload';

interface PreviewRow {
  row: number;
  raw: Record<string, string>;
  error: string | null;
}

const PREVIEW_LIMIT = 200;

/**
 * Bulk uploader with real-time validation. As soon as a file is chosen it is parsed in the
 * browser and every row is checked with the same Zod schema the server uses, so the officer sees
 * problems before uploading. Rules that need the database (payer exists, duplicate reference...)
 * are checked by the server, which returns the final report.
 */
export function CsvUploader({ allowedKinds }: { allowedKinds: CsvKind[] }) {
  const [kind, setKind] = useState<CsvKind>(allowedKinds[0] ?? 'payments');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const template = CSV_TEMPLATES[kind];
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`${template.columns.join(',')}\n${template.example}\n`)}`;

  function validate(text: string, currentKind: CsvKind) {
    setReport(null);
    setServerError(null);
    const parsed = Papa.parse<Record<string, string>>(text.trim(), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    if (parsed.data.length > MAX_CSV_ROWS) {
      setParseError(`The file has ${parsed.data.length} rows; the limit is ${MAX_CSV_ROWS}.`);
      setRows([]);
      return;
    }
    setParseError(
      parsed.errors[0]
        ? `Row ${(parsed.errors[0].row ?? 0) + 1}: ${parsed.errors[0].message}`
        : null,
    );
    const parseRow = currentKind === 'payments' ? parsePaymentCsvRow : parseAssessmentCsvRow;
    setRows(
      parsed.data.map((raw, index) => {
        const result = parseRow(raw);
        const issue = result.success ? null : result.error.issues[0];
        return {
          row: index + 1,
          raw,
          error: issue ? `${issue.path.join('.') || 'row'}: ${issue.message}` : null,
        };
      }),
    );
  }

  const invalidCount = useMemo(() => rows.filter((r) => r.error).length, [rows]);

  async function upload() {
    if (!file) return;
    setUploading(true);
    setServerError(null);
    const result = await uploadCsvAction({ kind, fileName: file.name, csv: file.text });
    setUploading(false);
    if (result.ok) setReport(result.data);
    else setServerError(result.error);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="grid gap-4 pt-5 md:grid-cols-3">
          <Field id="kind" label="What are you uploading?">
            <Select
              id="kind"
              value={kind}
              onChange={(e) => {
                const next = e.target.value as CsvKind;
                setKind(next);
                if (file) validate(file.text, next);
              }}
            >
              {allowedKinds.map((k) => (
                <option key={k} value={k}>
                  {k === 'payments' ? 'Revenue transactions (payments)' : 'Assessments'}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="file" label="CSV file" hint={`Columns: ${template.columns.join(', ')}`}>
            <Input
              id="file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const chosen = e.target.files?.[0];
                if (!chosen) return;
                const text = await chosen.text();
                setFile({ name: chosen.name, text });
                validate(text, kind);
              }}
            />
          </Field>
          <div className="flex items-end">
            <a
              className="text-sm text-primary hover:underline"
              href={templateHref}
              download={`${kind}-template.csv`}
            >
              Download a template
            </a>
          </div>
        </CardContent>
      </Card>

      {parseError ? <Alert tone="warning">{parseError}</Alert> : null}

      {rows.length > 0 && !report ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Preview: {rows.length} rows · {rows.length - invalidCount} look valid · {invalidCount}{' '}
              with problems
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <THead>
                <Tr>
                  <Th>Row</Th>
                  {template.columns.slice(0, 7).map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                  <Th>Check</Th>
                </Tr>
              </THead>
              <TBody>
                {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                  <Tr key={r.row} className={r.error ? 'bg-red-50' : undefined}>
                    <Td>{r.row}</Td>
                    {template.columns.slice(0, 7).map((c) => (
                      <Td key={c} className="text-xs">
                        {r.raw[c]}
                      </Td>
                    ))}
                    <Td className="text-xs">
                      {r.error ? <span className="text-destructive">{r.error}</span> : 'OK'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            {rows.length > PREVIEW_LIMIT ? (
              <p className="text-xs text-muted-foreground">
                Showing the first {PREVIEW_LIMIT} rows.
              </p>
            ) : null}
            {serverError ? <Alert tone="danger">{serverError}</Alert> : null}
            <div>
              <Button onClick={() => void upload()} disabled={uploading}>
                {uploading
                  ? 'Uploading…'
                  : invalidCount > 0
                    ? `Upload (${invalidCount} rows will be rejected)`
                    : 'Upload'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {report ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload report · {report.fileName}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-md border p-3">
                <div className="text-2xl font-semibold">{report.totalRows}</div>
                <div className="text-xs text-muted-foreground">Total rows</div>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-2xl font-semibold">{report.accepted}</div>
                <div className="text-xs">Accepted</div>
              </div>
              <div className="rounded-md border border-red-200 bg-red-50 p-3">
                <div className="text-2xl font-semibold">{report.rejected}</div>
                <div className="text-xs">Rejected</div>
              </div>
            </div>
            {report.errors.length > 0 ? (
              <Table>
                <THead>
                  <Tr>
                    <Th>Row</Th>
                    <Th>Reason</Th>
                  </Tr>
                </THead>
                <TBody>
                  {report.errors.map((e) => (
                    <Tr key={`${e.row}-${e.reason}`}>
                      <Td>{e.row}</Td>
                      <Td>{e.reason}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            ) : (
              <StatusBadge status="COMPLETED" />
            )}
            <div>
              <Button
                variant="outline"
                onClick={() => {
                  setReport(null);
                  setRows([]);
                  setFile(null);
                }}
              >
                Upload another file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
