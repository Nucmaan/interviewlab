import type { NextAuthConfig } from 'next-auth';

/**
 * Auth.js settings that do not need the database, so they can also be used by src/proxy.ts.
 * The credentials provider (password + TOTP check) is added in ./index.ts.
 */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // one working day

export const authConfig = {
  pages: { signIn: '/login' },
  session: {
    // Credentials logins require JWT sessions in Auth.js. The token only holds the user id;
    // roles and permissions are re-read from the database on every request (lib/rbac.ts), so a
    // deactivated user or a removed permission takes effect immediately.
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: 15 * 60,
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth }) {
      // Used by the proxy for page routes: no session -> redirect to /login.
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      if (typeof token.userId === 'string') session.user.id = token.userId;
      return session;
    },
  },
} satisfies NextAuthConfig;
