import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  computeAuditHash,
  GENESIS_HASH,
  verifyAuditChain,
  type AuditRowData,
  type StoredAuditRow,
} from './audit-hash';

function buildChain(entries: AuditRowData[]): StoredAuditRow[] {
  let prevHash = GENESIS_HASH;
  return entries.map((entry, i) => {
    const hash = computeAuditHash(prevHash, entry);
    const row = { ...entry, id: i + 1, prevHash, hash };
    prevHash = hash;
    return row;
  });
}

const entry = (n: number): AuditRowData => ({
  occurredAt: `2026-01-0${n}T10:00:00.000Z`,
  actorUserId: 1,
  action: 'UPDATE',
  entityType: 'payment',
  entityId: String(n),
  before: { status: 'PENDING' },
  after: { status: 'DONE', amount: n * 100 },
});

describe('canonicalJson', () => {
  it('produces the same string regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
  });
});

describe('verifyAuditChain', () => {
  it('accepts an untouched chain', () => {
    expect(verifyAuditChain(buildChain([entry(1), entry(2), entry(3)]))).toEqual({
      valid: true,
      checked: 3,
    });
  });

  it('detects an edited row', () => {
    const chain = buildChain([entry(1), entry(2), entry(3)]);
    chain[1] = { ...chain[1]!, after: { status: 'DONE', amount: 1 } };
    const result = verifyAuditChain(chain);
    expect(result.valid).toBe(false);
    expect(!result.valid && result.brokenAtId).toBe(2);
  });

  it('detects a deleted row', () => {
    const chain = buildChain([entry(1), entry(2), entry(3)]);
    const result = verifyAuditChain([chain[0]!, chain[2]!]);
    expect(!result.valid && result.brokenAtId).toBe(3);
  });

  it('detects a re-hashed edit because later rows no longer link', () => {
    const chain = buildChain([entry(1), entry(2), entry(3)]);
    const edited = { ...chain[0]!, after: { status: 'REVERSED' } };
    edited.hash = computeAuditHash(edited.prevHash, edited);
    const result = verifyAuditChain([edited, chain[1]!, chain[2]!]);
    expect(!result.valid && result.brokenAtId).toBe(2);
  });

  it('accepts an empty chain', () => {
    expect(verifyAuditChain([]).valid).toBe(true);
  });
});
