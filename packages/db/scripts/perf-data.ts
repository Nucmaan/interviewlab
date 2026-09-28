/**
 * OPTIONAL: bulk-generates synthetic payments for performance testing (default 1,000,000).
 * Rows are created inside PostgreSQL with generate_series, which is far faster than sending
 * them from Node. Afterwards it prints EXPLAIN ANALYZE for the quarterly report so you can see
 * the indexes from sql/02 in action.
 *
 *   pnpm db:perf-data                      # add 1,000,000 rows
 *   pnpm db:perf-data -- --count 5000000   # add 5,000,000 rows
 *   pnpm db:perf-data -- --cleanup         # remove every generated row again
 *
 * Generated rows have external_ref 'PERF-...' and are marked as already posted to FMIS, so the
 * worker does not try to post a million synthetic payments to the mock FMIS.
 */
import pg from 'pg';
import { loadEnv, log } from './env';

loadEnv();

const BATCH = 250_000;

function parseArgs(): { count: number; cleanup: boolean } {
  const args = process.argv.slice(2);
  const countIndex = args.indexOf('--count');
  const count = countIndex >= 0 ? Number(args[countIndex + 1]) : 1_000_000;
  if (!Number.isInteger(count) || count <= 0) throw new Error('--count must be a positive integer');
  return { count, cleanup: args.includes('--cleanup') };
}

async function main(): Promise<void> {
  const { count, cleanup } = parseArgs();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (cleanup) {
      const result = await client.query(`DELETE FROM payment WHERE external_ref LIKE 'PERF-%'`);
      await client.query(`SELECT refresh_daily_summary(current_date - 800, current_date)`);
      log(`removed ${result.rowCount} generated payments`);
      return;
    }

    const { rows } = await client.query<{ start: string }>(
      `SELECT COALESCE(MAX(substring(external_ref from 6)::bigint), 0) AS start
         FROM payment WHERE external_ref LIKE 'PERF-%'`,
    );
    let offset = Number(rows[0]?.start ?? 0);
    const started = Date.now();

    for (let done = 0; done < count; done += BATCH) {
      const size = Math.min(BATCH, count - done);
      await client.query(
        `INSERT INTO payment (payer_id, revenue_code, amount, currency, exchange_rate, amount_base,
                              channel, external_ref, paid_at, status, fmis_status, source, processed_at)
         SELECT 1 + (random() * (SELECT MAX(payer_id) - 1 FROM payer))::int,
                (ARRAY['BL','PR','MF','VL','SD','WTR'])[1 + floor(random() * 6)::int],
                amt, 'SOS', 1, amt,
                (ARRAY['BANK','MOBILE_MONEY','CASH']::"PaymentChannel"[])[1 + floor(random() * 3)::int],
                'PERF-' || lpad((n)::text, 12, '0'),
                ts, 'DONE', 'POSTED', 'BULK_API', ts
         FROM (
           SELECT g AS n,
                  round((1000 + random() * 500000)::numeric, 2) AS amt,
                  now() - random() * interval '730 days' AS ts
           FROM generate_series($1::bigint + 1, $1::bigint + $2::bigint) AS g
         ) s`,
        [offset, size],
      );
      offset += size;
      log(`inserted ${done + size} / ${count}`);
    }

    log('refreshing daily_summary and statistics...');
    await client.query(`SELECT refresh_daily_summary(current_date - 800, current_date)`);
    await client.query('ANALYZE payment');

    const year = new Date().getUTCFullYear() - 1;
    const plan = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS)
       SELECT p.revenue_code, date_trunc('quarter', p.paid_at) AS q, SUM(p.amount_base)
       FROM payment p
       WHERE p.status = 'DONE' AND p.paid_at >= make_date($1, 1, 1) AND p.paid_at < make_date($1 + 1, 1, 1)
       GROUP BY 1, 2`,
      [year],
    );
    process.stdout.write(`${plan.rows.map((r) => r['QUERY PLAN']).join('\n')}\n`);
    log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  log(`perf-data failed: ${(error as Error).message}`, 'error');
  process.exit(1);
});
