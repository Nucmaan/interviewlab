import { ActionButton } from '@/components/action-form';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { RefreshOnEvent } from '@/components/refresh-on-event';
import { StatusBadge } from '@/components/status-badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { parsePage, toPage, type SearchParams } from '@/lib/pagination';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { acknowledgeAlertAction } from '@/modules/dashboard/actions/dashboard-actions';

export const metadata = { title: 'Alerts' };

export default async function AlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePermission(['alerts.manage', 'audit.view']);
  const params = await searchParams;
  const page = parsePage(params);
  const [rows, total] = await Promise.all([
    prisma.alert.findMany({ orderBy: { created_at: 'desc' }, skip: page.skip, take: page.take }),
    prisma.alert.count(),
  ]);
  const result = toPage(rows, total, page);
  const canAck = hasPermission(user, 'alerts.manage');

  return (
    <div>
      <RefreshOnEvent types={['alert.created']} />
      <PageHeader
        title="Alerts"
        description="Raised by the worker: collections more than the configured % below the 7-day average, reversal spikes, permanently failed payments and FMIS posting failures."
      />
      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>When</Th>
              <Th>Type</Th>
              <Th>Severity</Th>
              <Th>Message</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {result.rows.map((a) => (
              <Tr key={a.alert_id}>
                <Td className="whitespace-nowrap">{formatDateTime(a.created_at)}</Td>
                <Td className="text-xs">{a.alert_type.replaceAll('_', ' ')}</Td>
                <Td>
                  <StatusBadge status={a.severity} />
                </Td>
                <Td>{a.message}</Td>
                <Td>
                  {a.acknowledged_at ? (
                    <span className="text-xs text-muted-foreground">
                      Acknowledged {formatDateTime(a.acknowledged_at)}
                    </span>
                  ) : canAck ? (
                    <ActionButton
                      action={acknowledgeAlertAction}
                      input={{ alertId: a.alert_id }}
                      label="Acknowledge"
                    />
                  ) : null}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
        <div className="px-4">
          <Pagination page={result} basePath="/alerts" searchParams={params} />
        </div>
      </Card>
    </div>
  );
}
