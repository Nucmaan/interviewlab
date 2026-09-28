import { ActionForm, FieldError } from '@/components/action-form';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/format';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { saveRevenueTypeAction } from '@/modules/revenue/actions/revenue-actions';

export const metadata = { title: 'Revenue types' };

export default async function RevenueTypesPage() {
  const user = await requirePermission(['revenue_types.manage', 'assessments.view']);
  const types = await prisma.revenueType.findMany({ orderBy: { revenue_code: 'asc' } });
  const bankGl = await prisma.systemConfig.findUnique({ where: { key: 'collection_bank_gl' } });

  return (
    <div>
      <PageHeader
        title="Revenue types & GL codes"
        description={`Each revenue type is credited to its GL code in FMIS; collections are debited to the bank GL ${String(bankGl?.value ?? '')}.`}
      />
      <Card className="mb-6">
        <Table>
          <THead>
            <Tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Category</Th>
              <Th>GL code</Th>
              <Th className="text-right">Default amount</Th>
              <Th>Status</Th>
            </Tr>
          </THead>
          <TBody>
            {types.map((t) => (
              <Tr key={t.revenue_code}>
                <Td className="font-mono">{t.revenue_code}</Td>
                <Td>
                  {t.name}
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </Td>
                <Td>{t.category}</Td>
                <Td className="font-mono">{t.gl_code}</Td>
                <Td className="text-right">
                  {t.default_amount ? formatMoney(t.default_amount.toString()) : '—'}
                </Td>
                <Td>
                  <StatusBadge status={t.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>

      {hasPermission(user, 'revenue_types.manage') ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>Add or update a revenue type</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Enter an existing code to update it. A changed GL code applies to future journals
              only.
            </p>
            <ActionForm
              action={saveRevenueTypeAction}
              successMessage="Revenue type saved."
              className="grid gap-4 md:grid-cols-2"
            >
              <Field id="revenueCode" label="Code">
                <Input id="revenueCode" name="revenueCode" />
                <FieldError name="revenueCode" />
              </Field>
              <Field id="name" label="Name">
                <Input id="name" name="name" />
                <FieldError name="name" />
              </Field>
              <Field id="category" label="Category">
                <Select id="category" name="category" defaultValue="TAX">
                  <option value="TAX">Tax</option>
                  <option value="WATER">Water</option>
                </Select>
              </Field>
              <Field id="glCode" label="GL code">
                <Input id="glCode" name="glCode" placeholder="1410-100" />
                <FieldError name="glCode" />
              </Field>
              <Field id="defaultAmount" label="Default amount (SOS)">
                <Input id="defaultAmount" name="defaultAmount" inputMode="decimal" />
              </Field>
              <Field id="isActive" label="Status">
                <Select id="isActive" name="isActive" defaultValue="true">
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field id="description" label="Description">
                  <Input id="description" name="description" />
                </Field>
              </div>
            </ActionForm>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
