import path from 'node:path';
import type { Page } from '@playwright/test';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'));
} catch {
  // Use real environment variables in CI.
}

/** Password of every seeded demo user (test accounts only). */
export const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'Demo@Ircub2026!';
/** The administrator has its own credentials (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD). */
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@ircub.test';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? DEMO_PASSWORD;

export async function login(
  page: Page,
  email: string,
  password = email === ADMIN_EMAIL ? ADMIN_PASSWORD : DEMO_PASSWORD,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait until the post-login redirect has fully loaded before the test navigates elsewhere.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { waitUntil: 'load' });
}

/** A reference that is unique per test run, so tests can be re-run against the same database. */
export function uniqueRef(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
