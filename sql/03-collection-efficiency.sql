-- ============================================================================================
-- Part 1 · Database & SQL · Q2 (part a) - Water collection efficiency
-- Technology: PostgreSQL 17.
--
-- For each tariff class and billing month: total billed, total collected, and
--   collection efficiency % = collected / billed x 100
--
-- Assumptions
--   * The brief has no bill table, so we added water_bill (see answers/00-assumptions.md).
--   * "Billed" = amount_billed, the current month's charges only (arrears carried forward are
--     not billed again, otherwise old debt would be counted twice).
--   * Bills still HELD for investigation, or CANCELLED, have not been sent, so they are excluded.
--   * "Collected" = successful payments (status DONE, in base currency) made against the bills of
--     that billing month. Because a payment can also clear arrears carried into that bill,
--     efficiency can exceed 100% in months where customers catch up.
--
-- Why two separate aggregates (billed, collected) that are joined afterwards?
--   Joining bills to payments FIRST and then summing amount_billed would count a bill once per
--   payment (a bill paid in 3 instalments would be billed 3 times). Aggregating each side on its
--   own and joining the totals avoids this "fan-out" double counting.
--
-- Usage:
--   SELECT * FROM collection_efficiency(date '2025-01-01', date '2026-12-01');
--
-- Used by the POC: apps/web/src/modules/dashboard/services/reports.ts
-- ============================================================================================

CREATE OR REPLACE FUNCTION collection_efficiency(p_from_month date, p_to_month date)
RETURNS TABLE (
  tariff_class     text,
  billing_month    date,
  amount_billed    numeric,
  amount_collected numeric,
  efficiency_pct   numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH billed AS (
    SELECT wa.tariff_class::text AS tariff_class,
           wb.billing_month,
           SUM(wb.amount_billed) AS amount_billed
    FROM water_bill wb
    JOIN water_account wa ON wa.account_no = wb.account_no
    WHERE wb.status NOT IN ('HELD', 'CANCELLED')
      AND wb.billing_month BETWEEN p_from_month AND p_to_month
    GROUP BY 1, 2
  ),
  collected AS (
    SELECT wa.tariff_class::text AS tariff_class,
           wb.billing_month,
           SUM(p.amount_base) AS amount_collected
    FROM payment p
    JOIN water_bill wb    ON wb.bill_id = p.bill_id
    JOIN water_account wa ON wa.account_no = wb.account_no
    WHERE p.status = 'DONE'
      AND wb.status NOT IN ('HELD', 'CANCELLED')
      AND wb.billing_month BETWEEN p_from_month AND p_to_month
    GROUP BY 1, 2
  )
  SELECT b.tariff_class,
         b.billing_month,
         b.amount_billed,
         COALESCE(c.amount_collected, 0) AS amount_collected,
         -- NULLIF turns a zero billed amount into NULL, so we return NULL instead of an error.
         ROUND(100.0 * COALESCE(c.amount_collected, 0) / NULLIF(b.amount_billed, 0), 2) AS efficiency_pct
  FROM billed b
  LEFT JOIN collected c
         ON c.tariff_class = b.tariff_class
        AND c.billing_month = b.billing_month
  ORDER BY b.billing_month, b.tariff_class;
$$;
