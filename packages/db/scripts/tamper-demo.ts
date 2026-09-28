/**
 * DEMO ONLY: simulates someone with direct database access editing an audit row, so the
 * "Verify chain" button on /audit can be shown detecting it.
 *
 *   pnpm --filter @ircub/db tamper-demo            # tamper with one row
 *   pnpm --filter @ircub/db tamper-demo -- --undo  # put the original value back
 *
 * It must switch off the append-only trigger first - exactly what a malicious DBA would do - which
 * is why the hash chain exists: the trigger prevents casual edits, the chain DETECTS deliberate ones.
 * Refuses to run unless the database name contains "ircub" and NODE_ENV is not production.
 */
import pg from 'pg';
import { loadEnv, log } from './env';

loadEnv();

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (process.env.NODE_ENV === 'production' || !/ircub/.test(url)) {
    throw new Error('tamper-demo only runs against a local ircub development database');
  }
  const undo = process.argv.includes('--undo');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete');
    const { rows } = await client.query<{ audit_id: number; after: unknown }>(
      `SELECT audit_id, after FROM audit_log WHERE action = 'LOGIN_SUCCESS' ORDER BY audit_id LIMIT 1`,
    );
    const target = rows[0];
    if (!target) throw new Error('No LOGIN_SUCCESS audit row to tamper with - sign in once first');
    await client.query(`UPDATE audit_log SET after = $1 WHERE audit_id = $2`, [
      undo ? null : JSON.stringify({ note: 'edited directly in the database' }),
      target.audit_id,
    ]);
    await client.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete');
    await client.query('COMMIT');
    log(
      undo
        ? `restored audit row #${target.audit_id}`
        : `tampered with audit row #${target.audit_id} - now run "Verify chain"`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  log(`tamper-demo failed: ${(error as Error).message}`, 'error');
  process.exit(1);
});
