import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['**/*.test.ts'],
    globalSetup: ['./global-setup.ts'],
    // Tests share one database, so they run one file at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
