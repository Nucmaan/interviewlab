import 'server-only';
import { createsRoleCycle, PERMISSIONS, type PermissionCode } from '@ircub/core';
import type { Prisma } from '@ircub/db';
import type { z } from 'zod';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError, NotFoundError } from '@/lib/errors';
import type { PageRequest } from '@/lib/pagination';
import type { CurrentUser } from '@/lib/rbac';
import type {
  createUserSchema,
  resetPasswordSchema,
  rolePermissionsSchema,
  roleSchema,
  updateUserSchema,
} from '../schemas/user';
import { hashPassword } from './passwords';

// ───────────── Users ─────────────

export async function listUsers(
  filters: { q?: string; roleId?: number; status?: string },
  page: PageRequest,
) {
  const where: Prisma.UserWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { email: { contains: filters.q, mode: 'insensitive' } },
            { full_name: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(filters.roleId ? { roles: { some: { role_id: filters.roleId } } } : {}),
    ...(filters.status === 'ACTIVE'
      ? { is_active: true }
      : filters.status === 'INACTIVE'
        ? { is_active: false }
        : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { email: 'asc' },
      skip: page.skip,
      take: page.take,
      include: { roles: { include: { role: { select: { name: true, role_id: true } } } } },
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

/** What we store in the audit log about a user: never the password hash or TOTP secret. */
function auditView(
  user: { email: string; full_name: string; is_active: boolean },
  roleIds: number[],
) {
  return { email: user.email, fullName: user.full_name, isActive: user.is_active, roleIds };
}

export async function createUser(input: z.output<typeof createUserSchema>, actor: CurrentUser) {
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new DomainError(`A user with email ${input.email} already exists`);
  }
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        full_name: input.fullName,
        password_hash: passwordHash,
        payer_id: input.payerId ?? null,
        roles: { create: input.roleIds.map((role_id) => ({ role_id })) },
      },
    });
    await audit(tx, actor, {
      action: 'USER_CREATED',
      entityType: 'user',
      entityId: user.user_id,
      after: auditView(user, input.roleIds),
    });
    return { userId: user.user_id };
  });
}

export async function updateUser(input: z.output<typeof updateUserSchema>, actor: CurrentUser) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({
      where: { user_id: input.userId },
      include: { roles: true },
    });
    if (!before) throw new NotFoundError('User');
    if (input.userId === actor.userId) {
      const adminRole = await tx.role.findUnique({ where: { code: 'SYSTEM_ADMIN' } });
      if (adminRole && !input.roleIds.includes(adminRole.role_id)) {
        throw new DomainError('You cannot remove the System Administrator role from yourself');
      }
    }
    const after = await tx.user.update({
      where: { user_id: input.userId },
      data: {
        full_name: input.fullName,
        roles: { deleteMany: {}, create: input.roleIds.map((role_id) => ({ role_id })) },
      },
    });
    await audit(tx, actor, {
      action: 'USER_UPDATED',
      entityType: 'user',
      entityId: input.userId,
      before: auditView(
        before,
        before.roles.map((r) => r.role_id),
      ),
      after: auditView(after, input.roleIds),
    });
    return { userId: input.userId };
  });
}

export async function setUserActive(userId: number, active: boolean, actor: CurrentUser) {
  if (userId === actor.userId && !active)
    throw new DomainError('You cannot deactivate your own account');
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { user_id: userId } });
    if (!before) throw new NotFoundError('User');
    // Deactivation takes effect on the user's next request: lib/rbac.ts checks is_active every time.
    await tx.user.update({ where: { user_id: userId }, data: { is_active: active } });
    await audit(tx, actor, {
      action: active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      entityType: 'user',
      entityId: userId,
      before: { isActive: before.is_active },
      after: { isActive: active },
    });
    return { userId };
  });
}

export async function resetPassword(
  input: z.output<typeof resetPasswordSchema>,
  actor: CurrentUser,
) {
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { user_id: input.userId } });
    if (!user) throw new NotFoundError('User');
    await tx.user.update({
      where: { user_id: input.userId },
      data: {
        password_hash: passwordHash,
        password_changed_at: new Date(),
        failed_login_count: 0,
        locked_until: null,
      },
    });
    await audit(tx, actor, {
      action: 'USER_PASSWORD_RESET',
      entityType: 'user',
      entityId: input.userId,
    });
    return { userId: input.userId };
  });
}

// ───────────── Roles and permissions ─────────────

export async function listRoles() {
  return prisma.role.findMany({
    orderBy: [{ is_system: 'desc' }, { name: 'asc' }],
    include: {
      parent: { select: { name: true } },
      permissions: { include: { permission: { select: { code: true } } } },
      _count: { select: { users: true } },
    },
  });
}

export async function createRole(input: z.output<typeof roleSchema>, actor: CurrentUser) {
  if (await prisma.role.findUnique({ where: { code: input.code } })) {
    throw new DomainError(`Role code ${input.code} is already used`);
  }
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        parent_role_id: input.parentRoleId ?? null,
        is_system: false,
      },
    });
    await audit(tx, actor, {
      action: 'ROLE_CREATED',
      entityType: 'role',
      entityId: role.role_id,
      after: input,
    });
    return { roleId: role.role_id };
  });
}

/** Replaces a role's permissions (and parent). Changes apply at every user's next request. */
export async function updateRolePermissions(
  input: z.output<typeof rolePermissionsSchema>,
  actor: CurrentUser,
) {
  const allRoles = await prisma.role.findMany({ select: { role_id: true, parent_role_id: true } });
  const parentRoleId = input.parentRoleId ?? null;
  if (
    createsRoleCycle(
      allRoles.map((r) => ({ roleId: r.role_id, parentRoleId: r.parent_role_id })),
      input.roleId,
      parentRoleId,
    )
  ) {
    throw new DomainError('That parent would make the role inherit from itself');
  }
  const codes = input.permissions.filter((c): c is PermissionCode => c in PERMISSIONS);
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({
      where: { role_id: input.roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundError('Role');
    const adminRole = role.code === 'SYSTEM_ADMIN';
    if (adminRole && (!codes.includes('roles.manage') || !codes.includes('users.manage'))) {
      // Otherwise nobody could ever fix permissions again.
      throw new DomainError(
        'The System Administrator role must keep users.manage and roles.manage',
      );
    }
    const permissionRows = await tx.permission.findMany({ where: { code: { in: codes } } });
    await tx.role.update({
      where: { role_id: input.roleId },
      data: {
        parent_role_id: parentRoleId,
        permissions: {
          deleteMany: {},
          create: permissionRows.map((p) => ({ permission_id: p.permission_id })),
        },
      },
    });
    await audit(tx, actor, {
      action: 'ROLE_PERMISSIONS_UPDATED',
      entityType: 'role',
      entityId: input.roleId,
      before: {
        parentRoleId: role.parent_role_id,
        permissions: role.permissions.map((p) => p.permission.code).sort(),
      },
      after: { parentRoleId, permissions: [...codes].sort() },
    });
    return { roleId: input.roleId };
  });
}

export async function deleteRole(roleId: number, actor: CurrentUser) {
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.findUnique({
      where: { role_id: roleId },
      include: { _count: { select: { users: true, children: true } } },
    });
    if (!role) throw new NotFoundError('Role');
    if (role.is_system) throw new DomainError('System roles cannot be deleted');
    if (role._count.users > 0)
      throw new DomainError('Remove this role from all users before deleting it');
    if (role._count.children > 0) throw new DomainError('Other roles inherit from this role');
    await tx.role.delete({ where: { role_id: roleId } });
    await audit(tx, actor, {
      action: 'ROLE_DELETED',
      entityType: 'role',
      entityId: roleId,
      before: { code: role.code, name: role.name },
    });
    return { roleId };
  });
}
