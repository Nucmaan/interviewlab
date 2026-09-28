-- ============================================================================================
-- Part 1 · Database & SQL · Q2 (part b) - Top 10 water accounts by arrears older than 90 days
-- Technology: PostgreSQL 17.
--
-- Assumptions
--   * "Arrears older than 90 days" = money still unpaid on bills whose due date is more than
--     90 days before the as-of date.
--   * Payments settle the OLDEST charges first (first in, first out). This is the usual utility
--     rule and it means:
--        arrears_over_90 = max(0, billed on bills due > 90 days ago - everything paid so far)
--     If a customer has paid more than all their old bills, they have no 90-day arrears, even
--     if some recent bills are unpaid.
--   * HELD and CANCELLED bills are not owed yet / any more, so they are excluded.
--   * Ties are broken by account number so the result is stable. Use FETCH FIRST 10 ROWS WITH
--     TIES instead of LIMIT if tied accounts at position 10 should all be shown.
--
-- Usage:
--   SELECT * FROM top_water_arrears();                        -- as of today, top 10
--   SELECT * FROM top_water_arrears(date '2026-06-30', 20);   -- as of a date, top 20
--
-- Used by the POC: apps/web/src/modules/dashboard/services/reports.ts
-- ============================================================================================

CREATE OR REPLACE FUNCTION top_water_arrears(
  p_as_of date DEFAULT current_date,
  p_limit int  DEFAULT 10
)
RETURNS TABLE (
  account_no           text,
  payer_id             int,
  full_name            text,
  tariff_class         text,
  arrears_over_90_days numeric,
  total_outstanding    numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH billed AS (
    SELECT wb.account_no,
           SUM(wb.amount_billed) AS total_billed,
           COALESCE(SUM(wb.amount_billed) FILTER (WHERE wb.due_date < p_as_of - 90), 0) AS billed_over_90
    FROM water_bill wb
    WHERE wb.status NOT IN ('HELD', 'CANCELLED')
      AND wb.billing_month <= p_as_of
    GROUP BY wb.account_no
  ),
  paid AS (
    SELECT wb.account_no, SUM(p.amount_base) AS total_paid
    FROM payment p
    JOIN water_bill wb ON wb.bill_id = p.bill_id
    WHERE p.status = 'DONE'
      AND p.paid_at < p_as_of + 1
    GROUP BY wb.account_no
  ),
  aged AS (
    SELECT b.account_no,
           GREATEST(b.billed_over_90 - COALESCE(pd.total_paid, 0), 0) AS arrears_over_90_days,
           b.total_billed - COALESCE(pd.total_paid, 0)                AS total_outstanding
    FROM billed b
    LEFT JOIN paid pd ON pd.account_no = b.account_no
  )
  SELECT a.account_no,
         wa.payer_id,
         py.full_name,
         wa.tariff_class::text,
         a.arrears_over_90_days,
         a.total_outstanding
  FROM aged a
  JOIN water_account wa ON wa.account_no = a.account_no
  JOIN payer py         ON py.payer_id = wa.payer_id
  WHERE a.arrears_over_90_days > 0
  ORDER BY a.arrears_over_90_days DESC, a.account_no
  LIMIT p_limit;
$$;
