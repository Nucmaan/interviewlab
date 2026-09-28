import 'server-only';
import type { PermissionCode } from '@ircub/core';
import { z } from 'zod';
import { isUserFacingError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentUser, hasPermission, type CurrentUser } from '@/lib/rbac';

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * Builds a server action with the same checks as an API route:
 * authenticate -> authorise -> validate with the SAME Zod schema the form uses -> run.
 *
 * The browser can call a server action directly, so the client-side validation in the form is
 * only for convenience; this server-side check is the one that counts.
 */
export function createAction<S extends z.ZodType, T>(
  permission: PermissionCode | readonly PermissionCode[],
  schema: S,
  handler: (input: z.output<S>, user: CurrentUser) => Promise<T>,
) {
  return async (input: z.input<S>): Promise<ActionResult<T>> => {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    if (!hasPermission(user, permission)) {
      return { ok: false, error: 'You do not have permission to do this.' };
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Please correct the highlighted fields.',
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      };
    }
    try {
      return { ok: true, data: await handler(parsed.data, user) };
    } catch (error) {
      if (isUserFacingError(error)) return { ok: false, error: error.message };
      logger.error({ err: error, userId: user.userId }, 'server action failed');
      return { ok: false, error: 'Something went wrong. Please try again or contact support.' };
    }
  };
}
