import Link from 'next/link';
import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { RefreshOnEvent } from '@/components/refresh-on-event';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDateTime } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { runBillingCycleAction } from '@/modules/water/actions/water-actions';

export const metadata = { title: 'Billing cycles' };

export default async function BillingPage() {
  const user = await requirePermission(['billing.run', 'water.view']);
  const cycles = await prisma.billingCycle.findMany({
    orderBy: { billing_month: 'desc' },
    take: 24,
  });
  const thisMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <RefreshOnEvent types={['billing.cycle']} />
      <PageHeader
        title="Billing cycles"
        description="The monthly run applies the tiered tariff, carries arrears forward, estimates missing readings and holds abnormal consumption for review."
      />
      {hasPermission(user, 'billing.run') ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Run a billing cycle</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={runBillingCycleAction}
              submitLabel="Run billing cycle"
              successMessage="Billing started. This page updates when it finishes."
            >
              <Field id="billingMonth" label="Billing month">
                <Input
                  id="billingMonth"
                  name="billingMonth"
                  type="month"
                  defaultValue={thisMonth}
                  max={thisMonth}
                />
                <FieldError name="billingMonth" />
              </Field>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Recent cycles</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <Tr>
              <Th>Month</Th>
              <Th>Status</Th>
              <Th className="text-right">Bills created</Th>
              <Th className="text-right">Held</Th>
              <Th className="text-right">Exceptions</Th>
              <Th>Started</Th>
              <Th>Finished</Th>
            </Tr>
          </THead>
          <TBody>
            {cycles.length === 0 ? (
              <Tr>
                <Td colSpan={7} className="text-muted-foreground">
                  No cycles run in the POC yet (the seed created 24 months of historical bills
                  directly).
                </Td>
              </Tr>
            ) : null}
            {cycles.map((c) => (
              <Tr key={c.cycle_id}>
                <Td>
                  <Link
                    className="text-primary hover:underline"
                    href={`/water/billing/${c.cycle_id}`}
                  >
                    {c.billing_month.toISOString().slice(0, 7)}
                  </Link>
                </Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td className="text-right">{c.bills_created}</Td>
                <Td className="text-right">{c.bills_held}</Td>
                <Td className="text-right">
                  {Array.isArray(c.exceptions) ? c.exceptions.length : 0}
                </Td>
                <Td>{formatDateTime(c.started_at)}</Td>
                <Td>{formatDateTime(c.completed_at)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
