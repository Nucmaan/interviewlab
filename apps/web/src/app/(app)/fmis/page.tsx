import { JournalBatchStatus } from '@ircub/db';
import Link from 'next/link';
import { ActionButton } from '@/components/action-form';
import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { RefreshOnEvent } from '@/components/refresh-on-event';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import {
  postPendingAction,
  retryBatchAction,
  reverseBatchAction,
} from '@/modules/fmis/actions/fmis-actions';
import { listBatches, parseBatchFilters } from '@/modules/fmis/services/fmis';

export const metadata = { title: 'FMIS journal batches' };

export default async function FmisPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission('fmis.view');
  const params = await searchParams;
  const page = parsePage(params);
  const filters = parseBatchFilters(params);
  const { rows, total, counts, unposted } = await listBatches(filters, page);
  const result = toPage(rows, total, page);
  const canPost = hasPermission(user, 'fmis.post');

  return (
    <div className="flex flex-col gap-4">
      <RefreshOnEvent types={['fmis.batch']} />
      <PageHeader
        title="FMIS journal batches"
        description="One balanced journal per business day: credit each revenue GL, debit the collection bank account. Posted automatically every night; failed postings are retried 3 times with exponential backoff."
        actions={
          canPost ? (
            <ActionButton
              action={postPendingAction}
              input={{}}
              label="Post pending days now"
              variant="default"
            />
          ) : null
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Posted" value={counts.POSTED ?? 0} />
        <StatCard label="Failed (needs review)" value={counts.FAILED ?? 0} />
        <StatCard label="Pending" value={counts.PENDING ?? 0} />
        <StatCard
          label="Payments not yet posted"
          value={unposted.toLocaleString('en-US')}
          hint="Today's payments are posted tomorrow"
        />
      </div>
      <FilterForm basePath="/fmis">
        <Field id="status" label="Status">
          <Select id="status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">All</option>
            {Object.values(JournalBatchStatus).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field id="date" label="Business date">
          <Input id="date" name="date" type="date" defaultValue={filters.date} />
        </Field>
      </FilterForm>
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Batch</Th>
              <Th>Business date</Th>
              <Th>Type</Th>
              <Th className="text-right">Lines</Th>
              <Th className="text-right">Debit = Credit</Th>
              <Th>FMIS reference</Th>
              <Th>Attempts</Th>
              <Th>Status</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((b) => (
              <Tr key={b.batch_id}>
                <Td>
                  <Link
                    className="text-primary hover:underline"
                    href={`/fmis/batches/${b.batch_id}`}
                  >
                    #{b.batch_id}
                  </Link>
                </Td>
                <Td>{formatDate(b.business_date)}</Td>
                <Td>{b.batch_type}</Td>
                <Td className="text-right">{b._count.lines}</Td>
                <Td className="text-right">{formatMoney(b.total_debit.toString())}</Td>
                <Td className="font-mono text-xs">{b.fmis_reference ?? '—'}</Td>
                <Td>
                  {b.attempts}
                  {b.last_error ? (
                    <div
                      className="max-w-56 truncate text-xs text-destructive"
                      title={b.last_error}
                    >
                      {b.last_error}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  <StatusBadge status={b.status} />
                  {b.posted_at ? (
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(b.posted_at)}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  {canPost && (b.status === 'FAILED' || b.status === 'PENDING') ? (
                    <ActionButton
                      action={retryBatchAction}
                      input={{ batchId: b.batch_id }}
                      label="Retry"
                    />
                  ) : null}
                  {canPost && b.status === 'POSTED' ? (
                    <ActionButton
                      action={reverseBatchAction}
                      input={{ batchId: b.batch_id }}
                      label="Reverse"
                      confirmText="Confirm reverse"
                    />
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/fmis" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
