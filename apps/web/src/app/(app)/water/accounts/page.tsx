import type { Prisma } from '@ircub/db';
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
import { formatMoney } from '@/lib/format';
import { first, parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Water accounts' };

const CLASSES = ['DOMESTIC', 'COMMERCIAL', 'INSTITUTIONAL'] as const;

export default async function WaterAccountsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePermission('water.view');
  const params = await searchParams;
  const page = parsePage(params);
  const q = first(params.q)?.trim();
  const tariffClass = CLASSES.find((c) => c === first(params.tariffClass));
  const where: Prisma.WaterAccountWhereInput = {
    ...(q
      ? {
          OR: [
            { account_no: { contains: q, mode: 'insensitive' } },
            { meter_no: { contains: q, mode: 'insensitive' } },
            { payer: { full_name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(tariffClass ? { tariff_class: tariffClass } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.waterAccount.findMany({
      where,
      orderBy: { account_no: 'asc' },
      skip: page.skip,
      take: page.take,
      include: { payer: true, bills: { orderBy: { billing_month: 'desc' }, take: 1 } },
    }),
    prisma.waterAccount.count({ where }),
  ]);
  const result = toPage(rows, total, page);

  return (
    <div>
      <PageHeader
        title="Water accounts"
        description="One payer can have several accounts and meters."
      />
      <FilterForm basePath="/water/accounts">
        <Field id="q" label="Account, meter or customer">
          <Input id="q" name="q" defaultValue={q} />
        </Field>
        <Field id="tariffClass" label="Tariff class">
          <Select id="tariffClass" name="tariffClass" defaultValue={tariffClass ?? ''}>
            <option value="">All</option>
            {CLASSES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </FilterForm>
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Account</Th>
              <Th>Customer</Th>
              <Th>Meter</Th>
              <Th>Class</Th>
              <Th>Latest bill</Th>
              <Th className="text-right">Balance on latest bill</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((a) => {
              const bill = a.bills[0];
              return (
                <Tr key={a.account_no}>
                  <Td>
                    <Link
                      className="text-primary hover:underline"
                      href={`/water/accounts/${a.account_no}`}
                    >
                      {a.account_no}
                    </Link>
                  </Td>
                  <Td>{a.payer.full_name}</Td>
                  <Td>{a.meter_no}</Td>
                  <Td>{a.tariff_class}</Td>
                  <Td>{bill ? bill.billing_month.toISOString().slice(0, 7) : '—'}</Td>
                  <Td className="text-right">
                    {bill ? formatMoney(Number(bill.total_due) - Number(bill.amount_paid)) : '—'}
                  </Td>
                  <Td>{bill ? <StatusBadge status={bill.status} /> : null}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/water/accounts" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
