-- ============================================================================================
-- Part 1 · Database & SQL · Q3 - Overdue penalty routine (stored function)
-- Technology: PostgreSQL 17, PL/pgSQL.
-- The same rules are implemented in TypeScript (packages/core/src/penalty.ts) and used by the
-- worker's daily job (apps/worker/src/jobs/penalties.ts). An integration test checks that both
-- give identical results.
--
-- Rules
--   * Months 1-3 overdue: 5% of the unpaid amount per month; month 4 onwards: 10% per month.
--   * Simple interest (no penalty on penalty), FULL months only (age() in PostgreSQL).
--   * Total penalty capped at 100% of the original amount_due.
--   * Rates and cap are read from system_config('penalty_rules') with the brief's values as
--     defaults, so they can change without a code change.
--   * A penalty already charged is never lowered by this job (GREATEST), so paying off the
--     principal does not wipe out penalties still owed. Only an approved waiver lowers it.
--
-- How idempotency is guaranteed (running twice on the same day never double-charges)
--   1. The TOTAL penalty is recalculated from scratch and SET on the assessment. It is never
--      "penalty_amount = penalty_amount + x", so a second run computes the same total again.
--   2. penalty_history has UNIQUE(assessment_id, run_date) and the insert uses
--      ON CONFLICT DO NOTHING: a second run on the same day adds no history rows.
--   3. Everything happens in ONE statement inside one transaction: the assessments are locked
--      (FOR UPDATE) and either all updates + history rows are saved, or none are.
--   4. An advisory lock makes two simultaneous runs wait for each other instead of interleaving.
--
-- Usage:
--   SELECT * FROM apply_overdue_penalties();                   -- as of today
--   SELECT * FROM apply_overdue_penalties(date '2026-03-01');  -- as of a given date
-- ============================================================================================

CREATE OR REPLACE FUNCTION apply_overdue_penalties(p_run_date date DEFAULT current_date)
RETURNS TABLE (assessments_updated int, history_rows_inserted int)
LANGUAGE plpgsql
AS $$
DECLARE
  cfg               jsonb;
  v_initial_months  int;
  v_initial_rate    numeric;
  v_later_rate      numeric;
  v_cap_pct         numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('apply_overdue_penalties'));

  SELECT value INTO cfg FROM system_config WHERE key = 'penalty_rules';
  v_initial_months := COALESCE((cfg ->> 'initialMonths')::int, 3);
  v_initial_rate   := COALESCE((cfg ->> 'initialRatePercent')::numeric, 5);
  v_later_rate     := COALESCE((cfg ->> 'laterRatePercent')::numeric, 10);
  v_cap_pct        := COALESCE((cfg ->> 'capPercent')::numeric, 100);

  RETURN QUERY
  WITH candidates AS (
    SELECT a.assessment_id,
           a.amount_due,
           a.penalty_amount AS current_penalty,
           GREATEST(a.amount_due - a.amount_paid, 0) AS unpaid,
           (EXTRACT(YEAR  FROM age(p_run_date, a.due_date)) * 12
          + EXTRACT(MONTH FROM age(p_run_date, a.due_date)))::int AS months_overdue
    FROM assessment a
    WHERE a.status IN ('OPEN', 'PART_PAID')
      AND a.due_date < p_run_date
    FOR UPDATE
  ),
  calculated AS (
    SELECT c.assessment_id,
           c.months_overdue,
           c.unpaid,
           GREATEST(
             c.current_penalty,
             LEAST(
               ROUND(c.unpaid * (LEAST(c.months_overdue, v_initial_months) * v_initial_rate
                               + GREATEST(c.months_overdue - v_initial_months, 0) * v_later_rate) / 100, 2),
               ROUND(c.amount_due * v_cap_pct / 100, 2)
             )
           ) AS new_penalty
    FROM candidates c
    WHERE c.months_overdue > 0
      AND c.unpaid > 0
  ),
  updated AS (
    UPDATE assessment a
       SET penalty_amount = calc.new_penalty,   -- SET the total, never add to it
           updated_at     = now()
      FROM calculated calc
     WHERE a.assessment_id = calc.assessment_id
       AND a.penalty_amount IS DISTINCT FROM calc.new_penalty
    RETURNING a.assessment_id
  ),
  history AS (
    INSERT INTO penalty_history (assessment_id, run_date, months_overdue, unpaid_amount, penalty_amount)
    SELECT calc.assessment_id, p_run_date, calc.months_overdue, calc.unpaid, calc.new_penalty
    FROM calculated calc
    ON CONFLICT (assessment_id, run_date) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT COUNT(*)::int FROM updated),
         (SELECT COUNT(*)::int FROM history);
END;
$$;
