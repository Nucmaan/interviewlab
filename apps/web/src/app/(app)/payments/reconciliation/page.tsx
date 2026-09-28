import { PageHeader } from '@/components/page-header';
import { requirePermission } from '@/lib/rbac';
import { ChannelReconciliationForm } from '@/modules/payments/components/channel-reconciliation-form';

export const metadata = { title: 'Channel reconciliation' };

export default async function ChannelReconciliationPage() {
  await requirePermission('reconciliation.run');
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Daily channel reconciliation"
        description="Compares IRCUB's successful payments for a channel and day with the channel's statement: matched, amount mismatch, missing in IRCUB (collected but never received) and missing in the statement."
      />
      <ChannelReconciliationForm today={new Date().toISOString().slice(0, 10)} />
    </div>
  );
}
