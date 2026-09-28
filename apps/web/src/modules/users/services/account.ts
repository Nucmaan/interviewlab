import 'server-only';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { DomainError } from '@/lib/errors';
import type { CurrentUser } from '@/lib/rbac';
import { hashPassword, verifyPassword } from './passwords';
import { createTotpSecret, totpQrCode, verifyTotp } from './totp';

/** Self-service account security: change password and optional TOTP 2FA. */

export async function changePassword(
  user: CurrentUser,
  currentPassword: string,
  newPassword: string,
) {
  const row = await prisma.user.findUniqueOrThrow({ where: { user_id: user.userId } });
  if (!(await verifyPassword(row.password_hash, currentPassword))) {
    throw new DomainError('Your current password is not correct');
  }
  if (await verifyPassword(row.password_hash, newPassword)) {
    throw new DomainError('Choose a password you have not used before');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { user_id: user.userId },
      data: { password_hash: passwordHash, password_changed_at: new Date() },
    });
    await audit(tx, user, {
      action: 'PASSWORD_CHANGED',
      entityType: 'user',
      entityId: user.userId,
    });
  });
}

/**
 * Step 1 of enabling 2FA: create a secret and show it as a QR code. 2FA is NOT switched on until
 * the user proves their app works by entering a valid code (step 2), so nobody locks themselves out.
 */
export async function startTotpSetup(
  user: CurrentUser,
): Promise<{ qrCode: string; secret: string }> {
  const secret = createTotpSecret();
  await prisma.user.update({
    where: { user_id: user.userId },
    data: { totp_secret: secret, totp_enabled: false },
  });
  return { qrCode: await totpQrCode(user.email, secret), secret };
}

export async function confirmTotp(user: CurrentUser, code: string) {
  const row = await prisma.user.findUniqueOrThrow({ where: { user_id: user.userId } });
  if (!row.totp_secret) throw new DomainError('Start the 2FA setup first');
  if (!(await verifyTotp(row.totp_secret, code)))
    throw new DomainError('That code is not correct. Try the newest code.');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { user_id: user.userId }, data: { totp_enabled: true } });
    await audit(tx, user, { action: 'TOTP_ENABLED', entityType: 'user', entityId: user.userId });
  });
}

export async function disableTotp(user: CurrentUser, password: string) {
  const row = await prisma.user.findUniqueOrThrow({ where: { user_id: user.userId } });
  if (!(await verifyPassword(row.password_hash, password)))
    throw new DomainError('Your password is not correct');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { user_id: user.userId },
      data: { totp_enabled: false, totp_secret: null },
    });
    await audit(tx, user, { action: 'TOTP_DISABLED', entityType: 'user', entityId: user.userId });
  });
}
