/**
 * Applies every file in /sql (in name order) after `prisma migrate deploy`.
 * The files only use CREATE OR REPLACE / IF NOT EXISTS, so running this again is safe.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { loadEnv, log } from './env';

loadEnv();

const SQL_DIR = path.resolve(import.meta.dirname, '../../../sql');

async function main(): Promise<void> {
  const files = (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const file of files) {
      const sql = await readFile(path.join(SQL_DIR, file), 'utf8');
      // Each file runs in its own transaction: a broken file leaves nothing half-applied.
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        log(`applied sql/${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Failed to apply sql/${file}: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  log(`apply-sql failed: ${(error as Error).message}`, 'error');
  process.exit(1);
});
