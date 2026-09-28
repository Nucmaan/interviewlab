import { PageHeader } from '@/components/page-header';
import { requirePermission } from '@/lib/rbac';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  await requirePermission('dashboard.view');
  return <PageHeader title="Executive dashboard" description="Charts are added in Phase 5." />;
}
