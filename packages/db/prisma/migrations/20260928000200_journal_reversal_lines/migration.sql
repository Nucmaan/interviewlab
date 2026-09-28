-- Reversal journal lines point at the payment they reverse. UNIQUE: a reversal is posted once.
ALTER TABLE "journal_line" ADD COLUMN "reversal_of_payment_id" INTEGER;

CREATE UNIQUE INDEX "journal_line_reversal_of_payment_id_key" ON "journal_line"("reversal_of_payment_id");
