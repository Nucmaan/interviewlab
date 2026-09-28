-- Database rules that Prisma's schema language cannot express.
-- They protect the data even if application code is bypassed or has a bug.

-- Segregation of duties: whoever requested a reversal can never be the one who decides it.
ALTER TABLE "reversal"
  ADD CONSTRAINT "reversal_four_eyes" CHECK ("decided_by" IS NULL OR "decided_by" <> "requested_by");

-- Money sanity checks.
ALTER TABLE "payment"
  ADD CONSTRAINT "payment_amount_positive" CHECK ("amount" > 0 AND "amount_base" > 0 AND "exchange_rate" > 0);
ALTER TABLE "assessment"
  ADD CONSTRAINT "assessment_amounts_valid"
  CHECK ("amount_due" > 0 AND "amount_paid" >= 0 AND "penalty_amount" >= 0 AND "penalty_amount" <= "amount_due");
ALTER TABLE "journal_line"
  ADD CONSTRAINT "journal_line_one_side"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND (("debit" = 0) <> ("credit" = 0)));
ALTER TABLE "journal_batch"
  ADD CONSTRAINT "journal_batch_balanced" CHECK ("total_debit" = "total_credit");
ALTER TABLE "meter_reading"
  ADD CONSTRAINT "meter_reading_non_negative" CHECK ("reading_value" >= 0 AND "consumption_m3" >= 0);
ALTER TABLE "tariff_band"
  ADD CONSTRAINT "tariff_band_rate_non_negative" CHECK ("rate_per_m3" >= 0 AND ("up_to_m3" IS NULL OR "up_to_m3" > 0));
ALTER TABLE "revenue_target"
  ADD CONSTRAINT "revenue_target_positive" CHECK ("target_amount" >= 0);

-- Sequences behind the control numbers (AS-YYYY-NNNNNNN-C and WB-YYYY-NNNNNNN-C).
-- A sequence never hands out the same value twice, even with many concurrent requests.
CREATE SEQUENCE "assessment_control_seq" START 1;
CREATE SEQUENCE "bill_control_seq" START 1;

-- The audit log is append-only: UPDATE, DELETE and TRUNCATE are refused.
-- (The hash chain additionally DETECTS tampering by anyone able to bypass this trigger.)
CREATE FUNCTION "audit_log_block_changes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP;
END;
$$;

CREATE TRIGGER "audit_log_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_block_changes"();

CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_log_block_changes"();
