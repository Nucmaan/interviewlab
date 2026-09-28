/**
 * Writing and verifying the hash-chained audit log. The hashing rules themselves are pure and live
 * in @ircub/core (audit-hash.ts); this file only deals with the database.
 */
import {
  computeAuditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type ChainVerification,
  type JsonValue,
  type StoredAuditRow,
} from '@ircub/core';
import { Prisma, type PrismaClient } from './generated/prisma/client';

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

// Any fixed number works; it just has to be the same everywhere audit rows are written.
const AUDIT_CHAIN_LOCK = 73_310_001;

/** Turns Decimals, Dates and undefined into plain JSON, exactly as it will be stored in JSONB. */
function toJson(value: unknown): JsonValue {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

/**
 * Appends one audit row. Must be called inside the same transaction as the change it describes,
 * so the change and its audit record are saved (or rolled back) together.
 *
 * The advisory lock makes concurrent writers take turns. Without it, two transactions could read
 * the same "last hash" and both link to it, which would fork the chain.
 */
export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
  const last = await tx.auditLog.findFirst({
    orderBy: { audit_id: 'desc' },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const occurredAt = new Date();
  const before = toJson(entry.before);
  const after = toJson(entry.after);
  const hash = computeAuditHash(prevHash, {
    occurredAt: occurredAt.toISOString(),
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    before,
    after,
  });

  await tx.auditLog.create({
    data: {
      occurred_at: occurredAt,
      actor_user_id: entry.actorUserId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: String(entry.entityId),
      before: before === null ? Prisma.DbNull : (before as Prisma.InputJsonValue),
      after: after === null ? Prisma.DbNull : (after as Prisma.InputJsonValue),
      ip_address: entry.ipAddress ?? null,
      prev_hash: prevHash,
      hash,
    },
  });
}

/** Re-computes every hash in insertion order, reading in pages to keep memory flat. */
export async function verifyAuditLog(
  prisma: PrismaClient,
  pageSize = 5000,
): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH;
  let afterId = 0;
  let checked = 0;

  for (;;) {
    const page = await prisma.auditLog.findMany({
      where: { audit_id: { gt: afterId } },
      orderBy: { audit_id: 'asc' },
      take: pageSize,
    });
    if (page.length === 0) return { valid: true, checked };

    const rows: StoredAuditRow[] = page.map((row) => ({
      id: row.audit_id,
      occurredAt: row.occurred_at.toISOString(),
      actorUserId: row.actor_user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: (row.before ?? null) as JsonValue,
      after: (row.after ?? null) as JsonValue,
      prevHash: row.prev_hash,
      hash: row.hash,
    }));
    const result = verifyAuditChain(rows, prevHash);
    if (!result.valid) return { ...result, checked: checked + result.checked };

    checked += rows.length;
    prevHash = rows[rows.length - 1]!.hash;
    afterId = rows[rows.length - 1]!.id;
  }
}
