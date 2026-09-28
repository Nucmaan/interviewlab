import Link from 'next/link';
import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { first, parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { listPayers, type PayerFilters } from '@/modules/registry/services/payers';

export const metadata = { title: 'Payers' };

export default async function PayersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission('payers.view');
  const params = await searchParams;
  const page = parsePage(params);
  const typeParam = first(params.payerType);
  const filters: PayerFilters = {
    q: first(params.q)?.trim() || undefined,
    payerType: typeParam === 'INDIVIDUAL' || typeParam === 'BUSINESS' ? typeParam : undefined,
    from: first(params.from) || undefined,
    to: first(params.to) || undefined,
  };
  const { rows, total } = await listPayers(filters, page);
  const result = toPage(rows, total, page);

  return (
    <div>
      <PageHeader
        title="Taxpayers & customers"
        description="Individuals and businesses, each with a unique TIN."
        actions={
          hasPermission(user, 'payers.create') ? (
            <Link href="/payers/new" className={buttonVariants()}>
              Register payer
            </Link>
          ) : null
        }
      />
      <FilterForm basePath="/payers">
        <Field id="q" label="TIN, name, phone or email">
          <Input id="q" name="q" defaultValue={filters.q} />
        </Field>
        <Field id="payerType" label="Type">
          <Select id="payerType" name="payerType" defaultValue={filters.payerType ?? ''}>
            <option value="">All</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="BUSINESS">Business</option>
          </Select>
        </Field>
        <Field id="from" label="Registered from">
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </Field>
        <Field id="to" label="Registered to">
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </Field>
      </FilterForm>
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>TIN</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Phone</Th>
              <Th>Assessments</Th>
              <Th>Water accounts</Th>
              <Th>Registered</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((p) => (
              <Tr key={p.payer_id}>
                <Td className="font-mono text-xs">{p.tin}</Td>
                <Td>
                  <Link className="text-primary hover:underline" href={`/payers/${p.payer_id}`}>
                    {p.full_name}
                  </Link>
                </Td>
                <Td>{p.payer_type === 'BUSINESS' ? 'Business' : 'Individual'}</Td>
                <Td>{p.phone ?? '—'}</Td>
                <Td>{p._count.assessments}</Td>
                <Td>{p._count.water_accounts}</Td>
                <Td>{formatDate(p.created_at)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/payers" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
