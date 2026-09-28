import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { verifyLogin, type LoginFailure } from '@/modules/users/services/auth-service';
import { authConfig } from './config';

/** Carries a machine-readable reason (e.g. "totp_required") back to the login form. */
class LoginError extends CredentialsSignin {
  constructor(code: LoginFailure) {
    super();
    this.code = code;
  }
}

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  totp: z.string().trim().max(10).optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(raw, request) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new LoginError('invalid');
        const result = await verifyLogin({
          ...parsed.data,
          totp: parsed.data.totp || undefined,
          ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        });
        if (!result.ok) throw new LoginError(result.code);
        return result.user;
      },
    }),
  ],
});
