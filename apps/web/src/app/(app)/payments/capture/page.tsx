import { PageHeader } from '@/components/page-header';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { CaptureForm } from '@/modules/payments/components/capture-form';

export const metadata = { title: 'Capture payment' };

export default async function CapturePaymentPage() {
  await requirePermission('payments.capture');
  const revenueTypes = await prisma.revenueType.findMany({
    where: { is_active: true },
    orderBy: { name: 'asc' },
    select: { revenue_code: true, name: true, category: true },
  });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Capture payment" description="Record payments received at the counter." />
      <CaptureForm
        revenueTypes={revenueTypes.map((t) => ({
          code: t.revenue_code,
          name: t.name,
          category: t.category,
        }))}
      />
    </div>
  );
}
