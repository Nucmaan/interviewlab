import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requirePermission } from '@/lib/rbac';
import { RegisterPayerForm } from '@/modules/registry/components/register-payer-form';

export const metadata = { title: 'Register payer' };

export default async function NewPayerPage() {
  await requirePermission('payers.create');
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Register payer"
        description="If the phone, email or national ID matches another payer, the registration is saved and flagged for review."
      />
      <Card>
        <CardContent className="pt-5">
          <RegisterPayerForm />
        </CardContent>
      </Card>
    </div>
  );
}
