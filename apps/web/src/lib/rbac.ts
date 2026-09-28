import 'server-only';
import { resolvePermissions, type PermissionCode } from '@ircub/core';
import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { cache } from 'react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isUserFacingError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Role-based access control: the ONE place that decides who may do what.
 * Pages, server actions and API routes all call into this file.
 */

export interface CurrentUser {
  userId: number;
  email: string;
  fullName: string;
  payerId: number | null;
  roles: { code: string; name: string }[];
  permissions: ReadonlySet<PermissionCode>;
  totpEnabled: boolean;
}

/** Permissions come from the database on every request, so changes apply immediately. */
async function loadPermissions(assignedRoleIds: number[]): Promise<Set<PermissionCode>> {
  const roles = await prisma.role.findMany({
    select: {
      role_id: true,
      parent_role_id: true,
      permissions: { select: { permission: { select: { code: true } } } },
    },
  });
  return resolvePermissions(
    roles.map((role) => ({
      roleId: role.role_id,
      parentRoleId: role.parent_role_id,
      permissions: role.permissions.map((p) => p.permission.code),
    })),
    assignedRoleIds,
  ) as Set<PermissionCode>;
}

/** The signed-in user, or null. `cache` makes it run once per request however often it is called. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const userId = Number(session?.user?.id);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    include: { roles: { include: { role: true } } },
  });
  // A deactivated user loses access at their next request, even with a valid session cookie.
  if (!user || !user.is_active) return null;

  return {
    userId: user.user_id,
    email: user.email,
    fullName: user.full_name,
    payerId: user.payer_id,
    roles: user.roles.map((r) => ({ code: r.role.code, name: r.role.name })),
    permissions: await loadPermissions(user.roles.map((r) => r.role_id)),
    totpEnabled: user.totp_enabled,
  };
});

export function hasPermission(
  user: CurrentUser | null,
  permission: PermissionCode | readonly PermissionCode[],
): boolean {
  if (!user) return false;
  const required = Array.isArray(permission) ? permission : [permission];
  // Any one of the listed permissions is enough.
  return required.some((p) => user.permissions.has(p));
}

/** For pages: send anonymous users to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/** For pages: users without the permission see the "not allowed" page. */
export async function requirePermission(
  permission: PermissionCode | readonly PermissionCode[],
): Promise<CurrentUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) redirect('/forbidden');
  return user;
}

type RouteContext<P> = { params: Promise<P> };

/**
 * Wraps an API route handler: authenticate -> authorise -> run. Returns JSON 401 / 403 instead
 * of redirects, and turns unexpected errors into a generic 500 without leaking internals.
 */
export function withPermission<P = Record<string, string>>(
  permission: PermissionCode | readonly PermissionCode[],
  handler: (request: NextRequest, context: { user: CurrentUser; params: P }) => Promise<Response>,
) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<Response> => {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!hasPermission(user, permission)) {
      return NextResponse.json(
        { error: 'You do not have permission for this action' },
        { status: 403 },
      );
    }
    try {
      return await handler(request, { user, params: await context.params });
    } catch (error) {
      return errorResponse(error, request);
    }
  };
}

export function errorResponse(error: unknown, request: NextRequest): Response {
  if (isUserFacingError(error)) {
    const status = 'status' in error && typeof error.status === 'number' ? error.status : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  logger.error({ err: error, path: request.nextUrl.pathname }, 'unhandled API error');
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
