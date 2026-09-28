/**
 * Prepares the separate ircub_test database once per run: Prisma migrations + /sql functions.
 * Never touches the demo database: TEST_DATABASE_URL must point at a database whose name ends
 * in "_test".
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

export default function setup(): void {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch {
    // CI provides real environment variables.
  }
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL must be set and point at a *_test database');
  }
  const env = { ...process.env, DATABASE_URL: url };
  const dbDir = path.join(root, 'packages/db');
  const bin = (name: string) =>
    path.join(dbDir, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
  execFileSync(bin('prisma'), ['migrate', 'deploy'], {
    cwd: dbDir,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  execFileSync(bin('tsx'), ['scripts/apply-sql.ts'], {
    cwd: dbDir,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}
