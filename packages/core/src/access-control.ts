/**
 * Role hierarchy, permission resolution, segregation of duties and password policy
 * (POC module 1).
 *
 * Roles can have a parent role and inherit all of its permissions. For example the Revenue
 * Supervisor inherits everything a Revenue Officer can do, and adds approve/reverse. Permissions
 * themselves live in the database (role_permission) so administrators can change them at runtime.
 */

export interface RoleNode {
  roleId: number;
  parentRoleId: number | null;
  permissions: readonly string[];
}

/** All permission codes a user has through their roles and the roles' ancestors. */
export function resolvePermissions(
  allRoles: readonly RoleNode[],
  assignedRoleIds: readonly number[],
): Set<string> {
  const byId = new Map(allRoles.map((role) => [role.roleId, role]));
  const permissions = new Set<string>();
  const visited = new Set<number>();

  for (const startId of assignedRoleIds) {
    let current = byId.get(startId);
    // `visited` stops an infinite loop if an administrator creates a cycle (A -> B -> A).
    while (current && !visited.has(current.roleId)) {
      visited.add(current.roleId);
      current.permissions.forEach((p) => permissions.add(p));
      current = current.parentRoleId === null ? undefined : byId.get(current.parentRoleId);
    }
  }
  return permissions;
}

/** Would setting `parentRoleId` as the parent of `roleId` create a loop? */
export function createsRoleCycle(
  allRoles: readonly Pick<RoleNode, 'roleId' | 'parentRoleId'>[],
  roleId: number,
  parentRoleId: number | null,
): boolean {
  const byId = new Map(allRoles.map((role) => [role.roleId, role]));
  let current = parentRoleId;
  const seen = new Set<number>();
  while (current !== null && !seen.has(current)) {
    if (current === roleId) return true;
    seen.add(current);
    current = byId.get(current)?.parentRoleId ?? null;
  }
  return false;
}

export class SegregationOfDutiesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SegregationOfDutiesError';
  }
}

/**
 * Four-eyes rule for reversals: the person who requested a reversal can never approve it,
 * even if they hold the approve permission. The database also enforces this with a CHECK
 * constraint, so it holds even if application code is bypassed.
 */
export function assertCanApprove(requestedByUserId: number, approverUserId: number): void {
  if (requestedByUserId === approverUserId) {
    throw new SegregationOfDutiesError(
      'You requested this reversal, so you cannot approve it. Another supervisor must approve.',
    );
  }
}

export const PASSWORD_MIN_LENGTH = 12;

/** Returns a list of problems; an empty list means the password meets the policy. */
export function checkPasswordPolicy(password: string, context: { email?: string } = {}): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Use at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[a-z]/.test(password)) problems.push('Add a lowercase letter');
  if (!/[A-Z]/.test(password)) problems.push('Add an uppercase letter');
  if (!/\d/.test(password)) problems.push('Add a number');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('Add a symbol');
  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    problems.push('Do not include your email name in the password');
  }
  return problems;
}
