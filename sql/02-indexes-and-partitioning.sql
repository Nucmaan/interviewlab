-- ============================================================================================
-- Part 1 · Database & SQL · Q1 (second half) - keeping the quarterly query fast on 50M payments
-- Technology: PostgreSQL 17.
--
-- The quarterly query filters on a date range (paid_at), groups by revenue_code and sums
-- amount_base for status = 'DONE'. The strategy has four layers:
--
--   1. Covering partial B-tree index  (paid_at, revenue_code) INCLUDE (amount_base) WHERE DONE
--      - paid_at first: the range filter narrows the scan to one financial year.
--      - revenue_code second: rows come out already grouped-friendly.
--      - INCLUDE amount_base: the SUM can be answered from the index alone
--        (an index-only scan), without touching the 50M-row table.
--      - WHERE status = 'DONE': failed / reversed rows are left out, so the index is smaller.
--
--   2. BRIN index on paid_at
--      - Payments are inserted roughly in time order, so physical order follows paid_at.
--      - A BRIN index stores only min/max per block range: a few hundred KB for 50M rows,
--        versus gigabytes for a B-tree. Good for wide date-range scans and reports.
--
--   3. Monthly range partitioning (example DDL below, on a separate demo table)
--      - A query for one financial year only touches 12 partitions ("partition pruning").
--      - Old years can be detached / archived without a huge DELETE.
--      - Not applied to the Prisma-managed `payment` table in this POC (see assumptions).
--
--   4. Pre-aggregated daily_summary table (one row per day x revenue type x channel)
--      - 2 years x ~15 revenue types x 3 channels = ~33,000 rows instead of 50,000,000.
--      - The dashboard reads ONLY this table. The worker refreshes it (function below).
--
-- In production, create indexes with CREATE INDEX CONCURRENTLY so writes are not blocked.
-- (CONCURRENTLY cannot run inside a transaction, so this runnable script uses the plain form.)
-- Check the plan with: EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM quarterly_collections(2025);
-- ============================================================================================

-- 1. Covering partial index for date range + revenue code aggregation.
CREATE INDEX IF NOT EXISTS payment_done_paid_at_revenue_idx
  ON payment (paid_at, revenue_code)
  INCLUDE (amount_base)
  WHERE status = 'DONE';

-- 2. BRIN index for very large, time-ordered scans.
CREATE INDEX IF NOT EXISTS payment_paid_at_brin
  ON payment USING brin (paid_at) WITH (pages_per_range = 64);

-- 3. Monthly range partitioning - example DDL on a separate demo table.
--    Note: in a partitioned table every PRIMARY KEY / UNIQUE constraint must include the
--    partition key. So UNIQUE(external_ref) alone is impossible; production would keep a small
--    separate table `payment_external_ref(external_ref PRIMARY KEY)` to enforce global uniqueness.
CREATE TABLE IF NOT EXISTS payment_partitioned_example (
  payment_id    bigint GENERATED ALWAYS AS IDENTITY,
  payer_id      int            NOT NULL,
  revenue_code  text           NOT NULL,
  amount        numeric(14, 2) NOT NULL,
  currency      text           NOT NULL,
  amount_base   numeric(16, 2) NOT NULL,
  channel       text           NOT NULL,
  external_ref  text           NOT NULL,
  status        text           NOT NULL,
  paid_at       timestamp(3)   NOT NULL,
  PRIMARY KEY (payment_id, paid_at),
  UNIQUE (external_ref, paid_at)
) PARTITION BY RANGE (paid_at);

-- One partition per month for 2025-2026, plus a DEFAULT partition as a safety net.
-- A scheduled job would create next month's partition ahead of time in production.
DO $$
DECLARE
  month_start date;
BEGIN
  FOR month_start IN
    SELECT generate_series(date '2025-01-01', date '2026-12-01', interval '1 month')::date
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF payment_partitioned_example
         FOR VALUES FROM (%L) TO (%L)',
      'payment_p' || to_char(month_start, 'YYYY_MM'),
      month_start,
      (month_start + interval '1 month')::date
    );
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS payment_partitioned_example_default
  PARTITION OF payment_partitioned_example DEFAULT;

-- Indexes created on the parent are created on every partition automatically.
CREATE INDEX IF NOT EXISTS payment_partitioned_example_paid_rev_idx
  ON payment_partitioned_example (paid_at, revenue_code) INCLUDE (amount_base)
  WHERE status = 'DONE';

-- 4. Refresh of the pre-aggregated daily_summary table for a date range.
--    Recomputing whole days (DELETE + INSERT in one transaction) is idempotent: running it twice
--    gives the same rows, unlike adding increments, which could double count after a retry.
--    Collections are counted on the day they were paid; reversals on the day they were approved.
CREATE OR REPLACE FUNCTION refresh_daily_summary(p_from date, p_to date)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  rows_written int;
BEGIN
  -- Two refreshes of the same days at the same time would fight over the same primary keys.
  PERFORM pg_advisory_xact_lock(hashtext('refresh_daily_summary'));

  DELETE FROM daily_summary WHERE summary_date BETWEEN p_from AND p_to;

  INSERT INTO daily_summary
    (summary_date, revenue_code, channel, payment_count, total_amount_base, reversal_count, refreshed_at)
  SELECT COALESCE(c.day, r.day),
         COALESCE(c.revenue_code, r.revenue_code),
         COALESCE(c.channel, r.channel),
         COALESCE(c.payment_count, 0),
         COALESCE(c.total, 0),
         COALESCE(r.reversal_count, 0),
         now()
  FROM (
    SELECT p.paid_at::date AS day, p.revenue_code, p.channel,
           COUNT(*)::int AS payment_count, SUM(p.amount_base) AS total
    FROM payment p
    WHERE p.status = 'DONE'
      AND p.paid_at >= p_from
      AND p.paid_at <  p_to + 1
    GROUP BY 1, 2, 3
  ) c
  FULL JOIN (
    SELECT rv.decided_at::date AS day, p.revenue_code, p.channel, COUNT(*)::int AS reversal_count
    FROM reversal rv
    JOIN payment p ON p.payment_id = rv.payment_id
    WHERE rv.status = 'APPROVED'
      AND rv.decided_at >= p_from
      AND rv.decided_at <  p_to + 1
    GROUP BY 1, 2, 3
  ) r
    ON r.day = c.day AND r.revenue_code = c.revenue_code AND r.channel = c.channel;

  GET DIAGNOSTICS rows_written = ROW_COUNT;
  RETURN rows_written;
END;
$$;
