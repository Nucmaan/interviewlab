import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/config';

/**
 * Runs before every page request: visitors without a session are redirected to /login.
 * API routes are excluded here because they answer 401 JSON themselves (lib/rbac.ts) and the
 * channel callbacks authenticate with an HMAC signature instead of a session.
 * Fine-grained permission checks happen in each page, action and route - not here.
 */
const { auth } = NextAuth(authConfig);

// Next.js needs a plain function export here (a destructured export is not recognised).
export default auth;

export const config = {
  matcher: ['/((?!api|login|api-docs|_next/static|_next/image|favicon.ico).*)'],
};
