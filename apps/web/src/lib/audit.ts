import 'server-only';
import { recordAudit, type AuditEntry, type Tx } from '@ircub/db';
import { headers } from 'next/headers';
import type { CurrentUser } from '@/lib/rbac';

/** Client IP as seen by the reverse proxy (first address in X-Forwarded-For). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip');
}

/** Records an audit entry for the current user inside the caller's transaction. */
export async function audit(
  tx: Tx,
  user: CurrentUser | null,
  entry: Omit<AuditEntry, 'actorUserId' | 'ipAddress'>,
): Promise<void> {
  await recordAudit(tx, {
    ...entry,
    actorUserId: user?.userId ?? null,
    ipAddress: await clientIp(),
  });
}
