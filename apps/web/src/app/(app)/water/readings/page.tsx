import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { requirePermission } from '@/lib/rbac';
import { captureReadingAction } from '@/modules/water/actions/water-actions';
import { ReadingUpload } from '@/modules/water/components/reading-upload';

export const metadata = { title: 'Meter readings' };

export default async function ReadingsPage() {
  await requirePermission('readings.capture');
  const recent = await prisma.meterReading.findMany({
    orderBy: { created_at: 'desc' },
    take: 25,
    include: { account: { select: { account_no: true } } },
  });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Meter readings"
        description="A reading lower than the previous one is rejected unless it is flagged as a rollover (meter passed 99,999) or a meter replacement."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Capture one reading</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={captureReadingAction}
              submitLabel="Save reading"
              successMessage="Reading saved: {consumption} m³ since the previous reading."
              resetOnSuccess
            >
              <Field id="accountNo" label="Account number">
                <Input id="accountNo" name="accountNo" placeholder="WA-000001" />
                <FieldError name="accountNo" />
              </Field>
              <Field id="readingDate" label="Reading date">
                <Input
                  id="readingDate"
                  name="readingDate"
                  type="date"
                  defaultValue={today}
                  max={today}
                />
                <FieldError name="readingDate" />
              </Field>
              <Field id="readingValue" label="Meter reading (m³)">
                <Input id="readingValue" name="readingValue" inputMode="numeric" />
                <FieldError name="readingValue" />
              </Field>
              <Field
                id="readingFlag"
                label="Reading is lower because…"
                hint="Leave as normal unless the meter rolled over or was replaced."
              >
                <Select id="readingFlag" name="readingFlag" defaultValue="NORMAL">
                  <option value="NORMAL">Normal reading</option>
                  <option value="ROLLOVER">Meter rolled over (passed its maximum)</option>
                  <option value="METER_REPLACEMENT">Meter was replaced</option>
                </Select>
              </Field>
            </ActionForm>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Upload readings (CSV)</CardTitle>
          </CardHeader>
          <CardContent>
            <ReadingUpload />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Latest captured readings</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Account</Th>
              <Th>Date</Th>
              <Th className="text-right">Reading</Th>
              <Th className="text-right">Consumption</Th>
              <Th>Type</Th>
              <Th>Flag</Th>
            </Tr>
          </THead>
          <TBody>
            {recent.map((r) => (
              <Tr key={r.reading_id}>
                <Td>{r.account.account_no}</Td>
                <Td>{formatDate(r.reading_date)}</Td>
                <Td className="text-right">{r.reading_value.toLocaleString('en-US')}</Td>
                <Td className="text-right">{r.consumption_m3} m³</Td>
                <Td>{r.reading_type}</Td>
                <Td>
                  {r.reading_flag === 'NORMAL' ? (
                    '—'
                  ) : (
                    <Badge tone="warning">{r.reading_flag}</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
