import { Badge, type BadgeProps } from '@/components/ui/badge';

const TONES: Record<string, BadgeProps['tone']> = {
  // payments
  DONE: 'success',
  PENDING: 'warning',
  PROCESSING: 'info',
  AWAITING_CONFIRMATION: 'info',
  FAILED: 'danger',
  REVERSED: 'danger',
  // assessments and bills
  PAID: 'success',
  PART_PAID: 'warning',
  OPEN: 'neutral',
  ISSUED: 'info',
  HELD: 'danger',
  CARRIED_FORWARD: 'neutral',
  CANCELLED: 'neutral',
  // FMIS and workflows
  POSTED: 'success',
  NOT_POSTED: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  RUNNING: 'info',
  COMPLETED: 'success',
  MATCHED: 'success',
  AMOUNT_MISMATCH: 'warning',
  MISSING_IN_IRCUB: 'danger',
  MISSING_IN_STATEMENT: 'danger',
  CONFIRMED_DUPLICATE: 'danger',
  NOT_DUPLICATE: 'neutral',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  SENT: 'success',
  QUEUED: 'warning',
  CRITICAL: 'danger',
  WARNING: 'warning',
  INFO: 'info',
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={TONES[status] ?? 'neutral'}>{status.replaceAll('_', ' ')}</Badge>;
}
