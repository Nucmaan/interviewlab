'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadReadingsAction } from '../actions/water-actions';
import type { ReadingUploadReport } from '../services/readings';

const TEMPLATE =
  'account_no,reading_date,reading_value,reading_flag\nWA-000001,2026-09-25,12345,NORMAL\n';

/** CSV upload of meter readings; each row is validated like a single capture. */
export function ReadingUpload() {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<ReadingUploadReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="file"
          accept=".csv,text/csv"
          aria-label="Readings CSV file"
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            setReport(null);
            if (chosen) setFile({ name: chosen.name, text: await chosen.text() });
          }}
        />
        <Button
          disabled={!file || pending}
          onClick={async () => {
            if (!file) return;
            setPending(true);
            setError(null);
            const result = await uploadReadingsAction({ csv: file.text });
            setPending(false);
            if (result.ok) setReport(result.data);
            else setError(result.error);
          }}
        >
          {pending ? 'Uploading…' : 'Upload readings'}
        </Button>
        <a
          className="text-sm text-primary hover:underline"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="readings-template.csv"
        >
          Template
        </a>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {report ? (
        <Alert tone={report.rejected > 0 ? 'warning' : 'success'}>
          {report.totalRows} rows · {report.accepted} accepted · {report.rejected} rejected
          {report.errors.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {report.errors.slice(0, 50).map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
    </div>
  );
}
