import Link from 'next/link';
import { ActionButton } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDateTime, formatMoney } from '@/lib/format';
import { first, parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { decideReversalAction } from '@/modules/payments/actions/reversal-actions';

export const metadata = { title: 'Reversals' };

export default async function ReversalsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission(['reversals.request', 'reversals.approve']);
  const params = await searchParams;
  const page = parsePage(params);
  const showAll = first(params.status) === 'ALL';
  const where = showAll ? {} : { status: 'PENDING_APPROVAL' as const };
  const [rows, total] = await Promise.all([
    prisma.reversal.findMany({
      where,
      orderBy: { requested_at: 'desc' },
      skip: page.skip,
      take: page.take,
      include: { payment: { include: { payer: true } }, requester: true, decider: true },
    }),
    prisma.reversal.count({ where }),
  ]);
  const result = toPage(rows, total, page);
  const canApprove = hasPermission(user, 'reversals.approve');

  return (
    <div>
      <PageHeader
        title="Reversals"
        description="Segregation of duties: the person who requested a reversal can never approve it."
        actions={
          <Link
            className="text-sm text-primary hover:underline"
            href={showAll ? '/payments/reversals' : '/payments/reversals?status=ALL'}
          >
            {showAll ? 'Show pending only' : 'Show all reversals'}
          </Link>
        }
      />
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Requested</Th>
              <Th>Payment</Th>
              <Th>Payer</Th>
              <Th className="text-right">Amount</Th>
              <Th>Reason</Th>
              <Th>Requested by</Th>
              <Th>Status</Th>
              <Th>Decision</Th>
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((r) => {
              const ownRequest = r.requested_by === user.userId;
              return (
                <Tr key={r.reversal_id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.requested_at)}</Td>
                  <Td>
                    <Link
                      className="text-primary hover:underline"
                      href={`/payments/${r.payment_id}`}
                    >
                      {r.payment.external_ref}
                    </Link>
                  </Td>
                  <Td>{r.payment.payer.full_name}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {formatMoney(r.payment.amount_base.toString())}
                  </Td>
                  <Td className="max-w-xs">{r.reason}</Td>
                  <Td>{r.requester.full_name}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>
                    {r.status === 'PENDING_APPROVAL' && canApprove ? (
                      ownRequest ? (
                        <span className="text-xs text-muted-foreground">
                          You requested this — another supervisor must decide.
                        </span>
                      ) : (
                        <div className="flex gap-2">
                          <ActionButton
                            action={decideReversalAction}
                            input={{ reversalId: r.reversal_id, approve: true }}
                            label="Approve"
                            variant="default"
                            confirmText="Confirm approve"
                          />
                          <ActionButton
                            action={decideReversalAction}
                            input={{ reversalId: r.reversal_id, approve: false }}
                            label="Reject"
                          />
                        </div>
                      )
                    ) : r.decider ? (
                      <span className="text-xs">
                        {r.decider.full_name}, {formatDateTime(r.decided_at)}
                      </span>
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/payments/reversals" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
