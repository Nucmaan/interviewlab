import 'server-only';
import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing with argon2id (the default of @node-rs/argon2), the current OWASP
 * recommendation. Each hash has its own random salt and is deliberately slow to compute, which
 * makes brute-forcing a stolen database expensive.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed hash must never let someone in.
    return false;
  }
}
