import { describe, expect, it } from 'vitest';
import {
  assertCanApprove,
  checkPasswordPolicy,
  createsRoleCycle,
  resolvePermissions,
  SegregationOfDutiesError,
} from './access-control';

const roles = [
  { roleId: 1, parentRoleId: null, permissions: ['payer.create', 'payment.capture'] },
  { roleId: 2, parentRoleId: 1, permissions: ['reversal.approve'] },
  { roleId: 3, parentRoleId: null, permissions: ['audit.view'] },
];

describe('resolvePermissions', () => {
  it('inherits permissions from parent roles', () => {
    expect([...resolvePermissions(roles, [2])].sort()).toEqual([
      'payer.create',
      'payment.capture',
      'reversal.approve',
    ]);
  });

  it('combines permissions from several roles', () => {
    expect(resolvePermissions(roles, [1, 3]).has('audit.view')).toBe(true);
  });

  it('survives a cycle in the role tree', () => {
    const cyclic = [
      { roleId: 1, parentRoleId: 2, permissions: ['a'] },
      { roleId: 2, parentRoleId: 1, permissions: ['b'] },
    ];
    expect([...resolvePermissions(cyclic, [1])].sort()).toEqual(['a', 'b']);
  });

  it('returns nothing for unknown roles', () => {
    expect(resolvePermissions(roles, [99]).size).toBe(0);
  });
});

describe('createsRoleCycle', () => {
  it('detects making a role its own ancestor', () => {
    expect(createsRoleCycle(roles, 1, 2)).toBe(true);
    expect(createsRoleCycle(roles, 1, 1)).toBe(true);
  });

  it('allows a normal parent', () => {
    expect(createsRoleCycle(roles, 3, 2)).toBe(false);
    expect(createsRoleCycle(roles, 3, null)).toBe(false);
  });
});

describe('assertCanApprove (segregation of duties)', () => {
  it('blocks the requester from approving their own reversal', () => {
    expect(() => assertCanApprove(7, 7)).toThrow(SegregationOfDutiesError);
  });

  it('allows a different user to approve', () => {
    expect(() => assertCanApprove(7, 8)).not.toThrow();
  });
});

describe('checkPasswordPolicy', () => {
  it('accepts a strong password', () => {
    expect(checkPasswordPolicy('Blue-Camel-River-42')).toEqual([]);
  });

  it('lists every problem with a weak password', () => {
    expect(checkPasswordPolicy('abc')).toEqual([
      'Use at least 12 characters',
      'Add an uppercase letter',
      'Add a number',
      'Add a symbol',
    ]);
  });

  it('rejects a password containing the email name', () => {
    expect(checkPasswordPolicy('Amina-Secure-2026', { email: 'amina@ircub.test' })).toContain(
      'Do not include your email name in the password',
    );
  });
});
