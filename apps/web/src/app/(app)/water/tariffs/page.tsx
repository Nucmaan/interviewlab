import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatDate, formatMoney } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { updateTariffAction } from '@/modules/water/actions/water-actions';

export const metadata = { title: 'Tariffs' };

/** "0–10 m³", "11–30 m³", "above 30 m³" labels from the bands' upper limits. */
function bandLabels(bands: { up_to_m3: number | null }[]): string[] {
  return bands.map((band, i) => {
    const from = i === 0 ? 0 : (bands[i - 1]?.up_to_m3 ?? 0);
    if (band.up_to_m3 === null) return `above ${from} m³`;
    return `${i === 0 ? 0 : from + 1}–${band.up_to_m3} m³`;
  });
}

export default async function TariffsPage() {
  const user = await requirePermission('water.view');
  const tariffs = await prisma.tariff.findMany({
    orderBy: [{ tariff_class: 'asc' }, { effective_from: 'desc' }],
    include: { bands: { orderBy: { sort_order: 'asc' } } },
  });
  const canEdit = hasPermission(user, 'water.accounts.manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Water tariffs"
        description="Tariffs are configuration (tariff and tariff_band tables), not code. Each band's rate applies only to the m³ inside that band."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {tariffs.map((t) => {
          const labels = bandLabels(t.bands);
          return (
            <Card key={t.tariff_id}>
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t.tariff_class} · from {formatDate(t.effective_from)} · service charge{' '}
                  {formatMoney(t.service_charge.toString())}
                </p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <Table>
                  <THead>
                    <Tr>
                      <Th>Band</Th>
                      <Th className="text-right">Rate per m³</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {t.bands.map((b, i) => (
                      <Tr key={b.band_id}>
                        <Td>{labels[i]}</Td>
                        <Td className="text-right">{formatMoney(b.rate_per_m3.toString())}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                {canEdit ? (
                  <ActionForm
                    action={updateTariffAction}
                    extra={{ tariffId: t.tariff_id }}
                    submitLabel="Save tariff"
                    successMessage="Tariff saved. It applies from the next billing cycle."
                  >
                    <Field id={`service-${t.tariff_id}`} label="Service charge">
                      <Input
                        id={`service-${t.tariff_id}`}
                        name="serviceCharge"
                        defaultValue={t.service_charge.toString()}
                      />
                    </Field>
                    <Field id={`bands-${t.tariff_id}`} label="Bands (up_to_m3:rate, * = no limit)">
                      <Textarea
                        id={`bands-${t.tariff_id}`}
                        name="bands"
                        className="font-mono text-xs"
                        rows={4}
                        defaultValue={t.bands
                          .map((b) => `${b.up_to_m3 ?? '*'}:${b.rate_per_m3.toString()}`)
                          .join('\n')}
                      />
                    </Field>
                  </ActionForm>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
