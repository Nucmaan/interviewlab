'use server';

import { AuthError, CredentialsSignin } from 'next-auth';
import { recordAudit } from '@ircub/db';
import { signIn, signOut } from '@/lib/auth';
import { clientIp } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/rbac';

export interface LoginState {
  error?: string;
  needsTotp?: boolean;
  email?: string;
}

const MESSAGES: Record<string, string> = {
  invalid: 'Email or password is incorrect.',
  locked: 'Too many failed attempts. Your account is locked for 15 minutes.',
  totp_required: 'Enter the 6-digit code from your authenticator app.',
  totp_invalid: 'That 2FA code is not correct. Try the newest code.',
};

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  try {
    await signIn('credentials', {
      email,
      password: String(formData.get('password') ?? ''),
      totp: String(formData.get('totp') ?? ''),
      redirectTo: '/',
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      const code = error instanceof CredentialsSignin ? error.code : 'invalid';
      return {
        error: MESSAGES[code] ?? MESSAGES.invalid,
        needsTotp: code === 'totp_required' || code === 'totp_invalid',
        email,
      };
    }
    // Successful sign-in "throws" a redirect, which Next.js must handle.
    throw error;
  }
}

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    const ipAddress = await clientIp();
    await prisma.$transaction((tx) =>
      recordAudit(tx, {
        actorUserId: user.userId,
        action: 'LOGOUT',
        entityType: 'user',
        entityId: user.userId,
        ipAddress,
      }),
    );
  }
  await signOut({ redirectTo: '/login' });
}
