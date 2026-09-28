import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against an already running stack (docker compose up, or pnpm dev).
 * Set E2E_BASE_URL to point somewhere else.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // The capture form must be usable on a tablet.
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] }, testMatch: /capture/ },
  ],
});
