import 'server-only';
import { recordAudit } from '@ircub/db';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { verifyPassword } from './passwords';
import { verifyTotp } from './totp';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export type LoginFailure = 'invalid' | 'locked' | 'totp_required' | 'totp_invalid';

export type LoginResult =
  | { ok: true; user: { id: string; name: string; email: string } }
  | { ok: false; code: LoginFailure };

/**
 * Checks a login attempt: account active, not locked, password correct, then TOTP if enabled.
 *
 * - The same "invalid" answer is returned for an unknown email, a wrong password and an inactive
 *   account, so an attacker cannot find out which emails exist.
 * - After MAX_FAILED_LOGINS wrong passwords the account is locked for LOCKOUT_MINUTES, which
 *   stops online password guessing.
 * - Every success and failure is written to the audit log.
 */
export async function verifyLogin(input: {
  email: string;
  password: string;
  totp?: string;
  ipAddress?: string | null;
}): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const fail = async (code: LoginFailure, reason: string, countAsFailure: boolean) => {
    await prisma.$transaction(async (tx) => {
      if (user && countAsFailure) {
        const failures = user.failed_login_count + 1;
        await tx.user.update({
          where: { user_id: user.user_id },
          data: {
            failed_login_count: failures,
            locked_until:
              failures >= MAX_FAILED_LOGINS
                ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                : user.locked_until,
          },
        });
      }
      await recordAudit(tx, {
        actorUserId: user?.user_id ?? null,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user?.user_id ?? email,
        after: { reason },
        ipAddress: input.ipAddress,
      });
    });
    logger.warn({ email, reason }, 'login failed');
    return { ok: false as const, code };
  };

  if (!user || !user.is_active) {
    return fail('invalid', user ? 'account inactive' : 'unknown email', false);
  }
  if (user.locked_until && user.locked_until > new Date()) {
    return fail('locked', 'account locked', false);
  }
  if (!(await verifyPassword(user.password_hash, input.password))) {
    return fail('invalid', 'wrong password', true);
  }
  if (user.totp_enabled && user.totp_secret) {
    if (!input.totp) return { ok: false, code: 'totp_required' };
    if (!(await verifyTotp(user.totp_secret, input.totp))) {
      return fail('totp_invalid', 'wrong 2FA code', true);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { user_id: user.user_id },
      data: { failed_login_count: 0, locked_until: null, last_login_at: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: user.user_id,
      action: 'LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.user_id,
      ipAddress: input.ipAddress,
    });
  });
  return { ok: true, user: { id: String(user.user_id), name: user.full_name, email: user.email } };
}
