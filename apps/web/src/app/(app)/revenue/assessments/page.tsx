import { AssessmentStatus } from '@ircub/db';
import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDate, formatMoney } from '@/lib/format';
import { parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { createAssessmentAction } from '@/modules/revenue/actions/revenue-actions';
import { listAssessments, parseAssessmentFilters } from '@/modules/revenue/services/assessments';

export const metadata = { title: 'Assessments' };

export default async function AssessmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission('assessments.view');
  const params = await searchParams;
  const page = parsePage(params);
  const filters = parseAssessmentFilters(params);
  const [{ rows, total }, types] = await Promise.all([
    listAssessments(filters, page),
    prisma.revenueType.findMany({ where: { category: 'TAX' }, orderBy: { name: 'asc' } }),
  ]);
  const result = toPage(rows, total, page);

  return (
    <div>
      <PageHeader
        title="Tax assessments"
        description="Each assessment has a unique control number (with a check digit) that the payer quotes when paying."
      />
      <FilterForm basePath="/revenue/assessments">
        <Field id="payer" label="Payer (TIN or name)">
          <Input id="payer" name="payer" defaultValue={filters.payer} />
        </Field>
        <Field id="revenueCode" label="Revenue type">
          <Select id="revenueCode" name="revenueCode" defaultValue={filters.revenueCode ?? ''}>
            <option value="">All</option>
            {types.map((t) => (
              <option key={t.revenue_code} value={t.revenue_code}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="status" label="Status">
          <Select id="status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">All</option>
            {Object.values(AssessmentStatus).map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="controlNumber" label="Control number">
          <Input id="controlNumber" name="controlNumber" defaultValue={filters.controlNumber} />
        </Field>
        <Field id="minAmount" label="Min amount due">
          <Input
            id="minAmount"
            name="minAmount"
            inputMode="decimal"
            defaultValue={filters.minAmount}
          />
        </Field>
        <Field id="maxAmount" label="Max amount due">
          <Input
            id="maxAmount"
            name="maxAmount"
            inputMode="decimal"
            defaultValue={filters.maxAmount}
          />
        </Field>
        <Field id="dueFrom" label="Due from">
          <Input id="dueFrom" name="dueFrom" type="date" defaultValue={filters.dueFrom} />
        </Field>
        <Field id="dueTo" label="Due to">
          <Input id="dueTo" name="dueTo" type="date" defaultValue={filters.dueTo} />
        </Field>
      </FilterForm>

      <Card className="mb-6">
        <Table>
          <THead>
            <Tr>
              <Th>Control number</Th>
              <Th>Payer</Th>
              <Th>Type</Th>
              <Th>Period</Th>
              <Th>Due</Th>
              <Th className="text-right">Due</Th>
              <Th className="text-right">Penalty</Th>
              <Th className="text-right">Paid</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((a) => (
              <Tr key={a.assessment_id}>
                <Td className="font-mono text-xs">{a.control_number}</Td>
                <Td>
                  <Link className="text-primary hover:underline" href={`/payers/${a.payer_id}`}>
                    {a.payer.full_name}
                  </Link>
                </Td>
                <Td>{a.revenue_code}</Td>
                <Td>{a.period}</Td>
                <Td>{formatDate(a.due_date)}</Td>
                <Td className="text-right">{formatMoney(a.amount_due.toString())}</Td>
                <Td className="text-right">{formatMoney(a.penalty_amount.toString())}</Td>
                <Td className="text-right">{formatMoney(a.amount_paid.toString())}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/revenue/assessments" searchParams={params} />
        </div>
      </Card>

      {hasPermission(user, 'assessments.create') ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Create assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={createAssessmentAction}
              submitLabel="Create assessment"
              successMessage="Assessment created with control number {controlNumber}."
              resetOnSuccess
              className="grid gap-4 md:grid-cols-2"
            >
              <Field id="new-tin" label="Payer TIN">
                <Input id="new-tin" name="tin" inputMode="numeric" />
                <FieldError name="tin" />
              </Field>
              <Field id="new-revenueCode" label="Revenue type">
                <Select id="new-revenueCode" name="revenueCode" defaultValue="">
                  <option value="">Choose…</option>
                  {types
                    .filter((t) => t.is_active)
                    .map((t) => (
                      <option key={t.revenue_code} value={t.revenue_code}>
                        {t.name}{' '}
                        {t.default_amount
                          ? `(default ${formatMoney(t.default_amount.toString())})`
                          : ''}
                      </option>
                    ))}
                </Select>
                <FieldError name="revenueCode" />
              </Field>
              <Field id="new-amountDue" label="Amount due (SOS)">
                <Input id="new-amountDue" name="amountDue" inputMode="decimal" />
                <FieldError name="amountDue" />
              </Field>
              <Field id="new-dueDate" label="Due date">
                <Input id="new-dueDate" name="dueDate" type="date" />
                <FieldError name="dueDate" />
              </Field>
              <Field id="new-period" label="Period">
                <Input id="new-period" name="period" placeholder="e.g. FY2026 or 2026-Q4" />
              </Field>
              <Field id="new-description" label="Description">
                <Input id="new-description" name="description" />
              </Field>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
