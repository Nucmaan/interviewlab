import { PaymentChannel, PaymentStatus } from '@ircub/db';
import Link from 'next/link';
import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDateTime, formatMoney } from '@/lib/format';
import { parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { requirePermission } from '@/lib/rbac';
import { listPayments, parsePaymentFilters } from '@/modules/payments/services/payment-queries';

export const metadata = { title: 'Payments' };

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('payments.view');
  const params = await searchParams;
  const page = parsePage(params);
  const filters = parsePaymentFilters(params);
  const [{ rows, total, doneTotal }, revenueTypes] = await Promise.all([
    listPayments(filters, page),
    prisma.revenueType.findMany({ orderBy: { name: 'asc' } }),
  ]);
  const result = toPage(rows, total, page);

  return (
    <div>
      <PageHeader
        title="Payments"
        description={`${total.toLocaleString('en-US')} payments match · successful total ${formatMoney(doneTotal?.toString() ?? 0)}`}
      />
      <FilterForm basePath="/payments">
        <Field id="payer" label="Payer (id, TIN or name)">
          <Input id="payer" name="payer" defaultValue={filters.payer} />
        </Field>
        <Field id="revenueCode" label="Revenue type">
          <Select id="revenueCode" name="revenueCode" defaultValue={filters.revenueCode ?? ''}>
            <option value="">All</option>
            {revenueTypes.map((t) => (
              <option key={t.revenue_code} value={t.revenue_code}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="channel" label="Channel">
          <Select id="channel" name="channel" defaultValue={filters.channel ?? ''}>
            <option value="">All</option>
            {Object.values(PaymentChannel).map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="status" label="Status">
          <Select id="status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">All</option>
            {Object.values(PaymentStatus).map((s) => (
              <option key={s} value={s}>
                {s.replaceAll('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="minAmount" label="Min amount (SOS)">
          <Input
            id="minAmount"
            name="minAmount"
            inputMode="decimal"
            defaultValue={filters.minAmount}
          />
        </Field>
        <Field id="maxAmount" label="Max amount (SOS)">
          <Input
            id="maxAmount"
            name="maxAmount"
            inputMode="decimal"
            defaultValue={filters.maxAmount}
          />
        </Field>
        <Field id="from" label="Paid from">
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </Field>
        <Field id="to" label="Paid to">
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </Field>
        <Field id="ref" label="External reference starts with">
          <Input id="ref" name="ref" defaultValue={filters.ref} />
        </Field>
      </FilterForm>

      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Paid at</Th>
              <Th>Reference</Th>
              <Th>Payer</Th>
              <Th>Type</Th>
              <Th>Channel</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">SOS</Th>
              <Th>Status</Th>
              <Th>FMIS</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((p) => (
              <Tr key={p.payment_id}>
                <Td className="whitespace-nowrap">{formatDateTime(p.paid_at)}</Td>
                <Td>
                  <Link className="text-primary hover:underline" href={`/payments/${p.payment_id}`}>
                    {p.external_ref}
                  </Link>
                </Td>
                <Td>
                  <Link className="hover:underline" href={`/payers/${p.payer_id}`}>
                    {p.payer.full_name}
                  </Link>
                </Td>
                <Td>{p.revenue_code}</Td>
                <Td>{p.channel.replace('_', ' ')}</Td>
                <Td className="text-right whitespace-nowrap">
                  {formatMoney(p.amount.toString(), p.currency)}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {formatMoney(p.amount_base.toString())}
                </Td>
                <Td>
                  <StatusBadge status={p.status} />
                </Td>
                <Td>
                  <StatusBadge status={p.fmis_status} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/payments" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
