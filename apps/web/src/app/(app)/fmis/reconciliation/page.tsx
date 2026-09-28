import Link from 'next/link';
import { Field } from '@/components/field';
import { FilterForm } from '@/components/filter-form';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { formatMoney } from '@/lib/format';
import { first, type SearchParams } from '@/lib/pagination';
import { requirePermission } from '@/lib/rbac';
import { getFmisReconciliation, getReconciliationDetail } from '@/modules/fmis/services/fmis';

export const metadata = { title: 'FMIS reconciliation' };

const isDate = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export default async function FmisReconciliationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePermission('fmis.view');
  const params = await searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const from = isDate(first(params.from)) ? first(params.from)! : defaultFrom;
  const to = isDate(first(params.to)) ? first(params.to)! : today.toISOString().slice(0, 10);
  const drillDate = first(params.date);
  const drillGl = first(params.gl);

  const { rows, bankGl, fmisAvailable } = await getFmisReconciliation(from, to);
  const detail =
    isDate(drillDate) && drillGl ? await getReconciliationDetail(drillDate, drillGl) : null;
  const differences = rows.filter((r) => !r.matched).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="IRCUB vs FMIS reconciliation"
        description={`Totals per business day and GL code. The bank GL ${bankGl} should equal the sum of the revenue GLs. Click a row to see the payments behind it.`}
      />
      <FilterForm basePath="/fmis/reconciliation">
        <Field id="from" label="From">
          <Input id="from" name="from" type="date" defaultValue={from} />
        </Field>
        <Field id="to" label="To">
          <Input id="to" name="to" type="date" defaultValue={to} />
        </Field>
      </FilterForm>
      {!fmisAvailable ? (
        <Alert tone="danger">FMIS did not answer, so only IRCUB totals are shown.</Alert>
      ) : null}
      <Alert tone={differences === 0 ? 'success' : 'warning'}>
        {differences === 0
          ? 'All days and GL codes match.'
          : `${differences} day/GL combination(s) differ. Recent days are usually just not posted yet (today is posted tomorrow); otherwise check for FAILED batches.`}
      </Alert>

      {detail ? (
        <Card>
          <CardHeader>
            <CardTitle>
              Payments on {drillDate} for GL {drillGl}
            </CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <Tr>
                <Th>Payment</Th>
                <Th>Payer</Th>
                <Th className="text-right">SOS</Th>
                <Th>Status</Th>
                <Th>Journal batch</Th>
              </Tr>
            </THead>
            <TBody>
              {detail.map((p) => (
                <Tr key={p.payment_id}>
                  <Td>
                    <Link
                      className="text-primary hover:underline"
                      href={`/payments/${p.payment_id}`}
                    >
                      {p.external_ref}
                    </Link>
                  </Td>
                  <Td>{p.payer.full_name}</Td>
                  <Td className="text-right">{formatMoney(p.amount_base.toString())}</Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                  <Td>
                    {p.journal_line ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/fmis/batches/${p.journal_line.batch_id}`}
                      >
                        #{p.journal_line.batch_id}{' '}
                        <StatusBadge status={p.journal_line.batch.status} />
                      </Link>
                    ) : (
                      <StatusBadge status="NOT_POSTED" />
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <Card>
        <Table>
          <THead>
            <Tr>
              <Th>Business date</Th>
              <Th>GL code</Th>
              <Th className="text-right">IRCUB</Th>
              <Th className="text-right">FMIS</Th>
              <Th className="text-right">Difference</Th>
              <Th>Result</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr
                key={`${r.businessDate}-${r.glCode}`}
                className={r.matched ? undefined : 'bg-amber-50'}
              >
                <Td>{r.businessDate}</Td>
                <Td className="font-mono">
                  <Link
                    className="text-primary hover:underline"
                    href={`/fmis/reconciliation?from=${from}&to=${to}&date=${r.businessDate}&gl=${r.glCode}`}
                  >
                    {r.glCode}
                  </Link>
                  {r.glCode === bankGl ? (
                    <span className="ml-1 text-xs text-muted-foreground">(bank)</span>
                  ) : null}
                </Td>
                <Td className="text-right">{formatMoney(r.ircubTotal)}</Td>
                <Td className="text-right">{formatMoney(r.fmisTotal)}</Td>
                <Td className="text-right">{r.difference ? formatMoney(r.difference) : '—'}</Td>
                <Td>
                  <StatusBadge status={r.matched ? 'MATCHED' : 'AMOUNT_MISMATCH'} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
