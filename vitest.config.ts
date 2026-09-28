import { defineConfig } from 'vitest/config';

// Root test runner: `pnpm test` (unit, packages/core) and `pnpm test:integration`.
export default defineConfig({
  test: {
    projects: ['packages/core', 'tests/integration'],
  },
});
