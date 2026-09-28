/**
 * Tamper-evident audit log hashing (POC module 3).
 *
 * Every audit row stores hash = SHA256(prev_hash + canonical_json(row_data)). Each hash depends
 * on the row before it, like a chain. If someone edits, deletes or inserts a row directly in the
 * database, that row's hash no longer matches, and neither does any hash after it. The
 * "verify chain" check recomputes every hash and reports the first row that does not match.
 *
 * This DETECTS tampering; it does not prevent it. Prevention is an append-only trigger on the
 * table plus database permissions - see answers/part-4-security-planning-qa.md.
 */
import { createHash } from 'node:crypto';

/** Hash used as "previous hash" for the very first row. */
export const GENESIS_HASH = '0'.repeat(64);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * JSON with object keys sorted, so the same data always gives the same string (and hash)
 * no matter what order the properties were added in, or how PostgreSQL stores JSONB.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`).join(',')}}`;
}

export interface AuditRowData {
  occurredAt: string;
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  before: JsonValue;
  after: JsonValue;
}

export function computeAuditHash(prevHash: string, data: AuditRowData): string {
  const payload: JsonValue = {
    occurredAt: data.occurredAt,
    actorUserId: data.actorUserId,
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId,
    before: data.before,
    after: data.after,
  };
  return createHash('sha256')
    .update(prevHash + canonicalJson(payload))
    .digest('hex');
}

export interface StoredAuditRow extends AuditRowData {
  id: number;
  prevHash: string;
  hash: string;
}

export type ChainVerification =
  | { valid: true; checked: number }
  | { valid: false; checked: number; brokenAtId: number; reason: string };

/** Rows must be passed in insertion order (ascending id). */
export function verifyAuditChain(
  rows: readonly StoredAuditRow[],
  startingPrevHash: string = GENESIS_HASH,
): ChainVerification {
  let expectedPrev = startingPrevHash;
  for (const [index, row] of rows.entries()) {
    if (row.prevHash !== expectedPrev) {
      return {
        valid: false,
        checked: index,
        brokenAtId: row.id,
        reason: 'prev_hash does not match the hash of the previous row (row deleted or inserted)',
      };
    }
    if (computeAuditHash(row.prevHash, row) !== row.hash) {
      return {
        valid: false,
        checked: index,
        brokenAtId: row.id,
        reason: 'hash does not match the row data (row was edited)',
      };
    }
    expectedPrev = row.hash;
  }
  return { valid: true, checked: rows.length };
}
