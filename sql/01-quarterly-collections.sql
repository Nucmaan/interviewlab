-- ============================================================================================
-- Part 1 · Database & SQL · Q1 - Advanced SQL query: quarterly collections per revenue type
-- Technology: PostgreSQL 17 (window functions).
--
-- For every revenue type and every quarter of a financial year it returns:
--   * total collected in the quarter
--   * running total up to and including that quarter (per revenue type)
--   * percentage share of the revenue type within the quarter
--
-- Assumptions
--   * Only successful collections count: payment.status = 'DONE' (failed and reversed are excluded).
--   * Totals use amount_base (SOS). Payments arrive in USD and SOS, and adding the raw `amount`
--     column would mix currencies.
--   * The financial year may start in any month: p_fy_start_month (1 = Jan, 7 = Jul ...).
--     A financial year is labelled by the calendar year in which it starts
--     (FY2025 with a July start = 1 Jul 2025 to 30 Jun 2026).
--   * paid_at is stored in UTC.
--   * A revenue type that collected something in the year appears in all 4 quarters (0 when
--     nothing was collected), so the running total never "skips" a quarter.
--
-- Usage:
--   SELECT * FROM quarterly_collections(2025);      -- calendar year 2025
--   SELECT * FROM quarterly_collections(2025, 7);   -- FY Jul 2025 - Jun 2026
--
-- Used by the POC: apps/web/src/modules/dashboard/services/reports.ts
-- Index design for 50 million rows: see sql/02-indexes-and-partitioning.sql
-- ============================================================================================

CREATE OR REPLACE FUNCTION quarterly_collections(
  p_financial_year int,
  p_fy_start_month int DEFAULT 1
)
RETURNS TABLE (
  revenue_code         text,
  revenue_name         text,
  quarter              int,
  total_collected      numeric,
  running_total        numeric,
  share_of_quarter_pct numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH bounds AS (
    SELECT make_date(p_financial_year, p_fy_start_month, 1)                      AS fy_start,
           (make_date(p_financial_year, p_fy_start_month, 1) + interval '1 year') AS fy_end
  ),
  quarterly AS (
    -- Filter on a plain range of paid_at (not a function of it) so the index on paid_at is used.
    -- Quarter number with an offset: months since the financial year started, divided by 3.
    SELECT p.revenue_code,
           ((EXTRACT(MONTH FROM p.paid_at)::int - p_fy_start_month + 12) % 12) / 3 + 1 AS quarter,
           SUM(p.amount_base) AS total_collected
    FROM payment p
    CROSS JOIN bounds b
    WHERE p.status = 'DONE'
      AND p.paid_at >= b.fy_start
      AND p.paid_at <  b.fy_end
    GROUP BY 1, 2
  ),
  grid AS (
    -- Every active-in-the-year revenue type x quarters 1-4.
    SELECT rt.revenue_code, rt.name, q.quarter
    FROM revenue_type rt
    CROSS JOIN generate_series(1, 4) AS q(quarter)
    WHERE rt.revenue_code IN (SELECT revenue_code FROM quarterly)
  )
  SELECT g.revenue_code,
         g.name,
         g.quarter,
         COALESCE(q.total_collected, 0) AS total_collected,
         -- Running total: add up this revenue type's quarters in order.
         SUM(COALESCE(q.total_collected, 0))
           OVER (PARTITION BY g.revenue_code ORDER BY g.quarter) AS running_total,
         -- Share: this row / the total of all revenue types in the same quarter.
         -- NULLIF avoids division by zero for a quarter with no collections at all.
         ROUND(
           100.0 * COALESCE(q.total_collected, 0)
             / NULLIF(SUM(COALESCE(q.total_collected, 0)) OVER (PARTITION BY g.quarter), 0),
           2
         ) AS share_of_quarter_pct
  FROM grid g
  LEFT JOIN quarterly q
         ON q.revenue_code = g.revenue_code
        AND q.quarter = g.quarter
  ORDER BY g.quarter, g.revenue_code;
$$;
