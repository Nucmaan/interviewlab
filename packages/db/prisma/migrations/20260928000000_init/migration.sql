-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "DuplicateField" AS ENUM ('PHONE', 'EMAIL', 'NATIONAL_ID');

-- CreateEnum
CREATE TYPE "DuplicateFlagStatus" AS ENUM ('OPEN', 'CONFIRMED_DUPLICATE', 'NOT_DUPLICATE');

-- CreateEnum
CREATE TYPE "RevenueCategory" AS ENUM ('TAX', 'WATER');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('OPEN', 'PART_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'SOS');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('BANK', 'MOBILE_MONEY', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('CALLBACK', 'BULK_API', 'CSV_UPLOAD', 'COUNTER', 'PORTAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('AWAITING_CONFIRMATION', 'PENDING', 'PROCESSING', 'DONE', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "FmisStatus" AS ENUM ('NOT_POSTED', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ReversalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TariffClass" AS ENUM ('DOMESTIC', 'COMMERCIAL', 'INSTITUTIONAL');

-- CreateEnum
CREATE TYPE "WaterAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISCONNECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReadingType" AS ENUM ('ACTUAL', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "ReadingFlag" AS ENUM ('NORMAL', 'ROLLOVER', 'METER_REPLACEMENT');

-- CreateEnum
CREATE TYPE "BillingCycleStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "WaterBillStatus" AS ENUM ('HELD', 'ISSUED', 'PART_PAID', 'PAID', 'CARRIED_FORWARD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JournalBatchStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "JournalBatchType" AS ENUM ('COLLECTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ChannelMatchStatus" AS ENUM ('MATCHED', 'AMOUNT_MISMATCH', 'MISSING_IN_IRCUB', 'MISSING_IN_STATEMENT');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('COLLECTION_DROP', 'REVERSAL_SPIKE', 'PAYMENT_FAILED', 'FMIS_POSTING_FAILED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "app_user" (
    "user_id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),
    "payer_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "role" (
    "role_id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "parent_role_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "permission" (
    "permission_id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" INTEGER NOT NULL,
    "permission_id" INTEGER NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "user_id" INTEGER NOT NULL,
    "role_id" INTEGER NOT NULL,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" INTEGER,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "payer" (
    "payer_id" SERIAL NOT NULL,
    "payer_type" "PayerType" NOT NULL,
    "full_name" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "national_id" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,

    CONSTRAINT "payer_pkey" PRIMARY KEY ("payer_id")
);

-- CreateTable
CREATE TABLE "duplicate_flag" (
    "flag_id" SERIAL NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "matched_payer_id" INTEGER NOT NULL,
    "match_field" "DuplicateField" NOT NULL,
    "status" "DuplicateFlagStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_flag_pkey" PRIMARY KEY ("flag_id")
);

-- CreateTable
CREATE TABLE "revenue_type" (
    "revenue_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "RevenueCategory" NOT NULL,
    "gl_code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_amount" DECIMAL(14,2),
    "description" TEXT,

    CONSTRAINT "revenue_type_pkey" PRIMARY KEY ("revenue_code")
);

-- CreateTable
CREATE TABLE "assessment" (
    "assessment_id" SERIAL NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "revenue_code" TEXT NOT NULL,
    "amount_due" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "penalty_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'OPEN',
    "control_number" TEXT NOT NULL,
    "period" TEXT,
    "description" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_pkey" PRIMARY KEY ("assessment_id")
);

-- CreateTable
CREATE TABLE "penalty_history" (
    "penalty_history_id" SERIAL NOT NULL,
    "assessment_id" INTEGER NOT NULL,
    "run_date" DATE NOT NULL,
    "months_overdue" INTEGER NOT NULL,
    "unpaid_amount" DECIMAL(14,2) NOT NULL,
    "penalty_amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "penalty_history_pkey" PRIMARY KEY ("penalty_history_id")
);

-- CreateTable
CREATE TABLE "revenue_target" (
    "target_id" SERIAL NOT NULL,
    "revenue_code" TEXT NOT NULL,
    "period_month" DATE NOT NULL,
    "target_amount" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "revenue_target_pkey" PRIMARY KEY ("target_id")
);

-- CreateTable
CREATE TABLE "payment" (
    "payment_id" SERIAL NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "assessment_id" INTEGER,
    "bill_id" INTEGER,
    "revenue_code" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "exchange_rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
    "amount_base" DECIMAL(16,2) NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "external_ref" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fmis_status" "FmisStatus" NOT NULL DEFAULT 'NOT_POSTED',
    "source" "PaymentSource" NOT NULL,
    "provider_ref" TEXT,
    "status_check_attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "captured_by" INTEGER,
    "processing_started_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "reversal" (
    "reversal_id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReversalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requested_by" INTEGER NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "reversal_pkey" PRIMARY KEY ("reversal_id")
);

-- CreateTable
CREATE TABLE "rejected_payment" (
    "rejected_id" SERIAL NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "batch_ref" TEXT,
    "row_number" INTEGER,
    "external_ref" TEXT,
    "payload" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejected_payment_pkey" PRIMARY KEY ("rejected_id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "exchange_rate" (
    "rate_id" SERIAL NOT NULL,
    "currency" "Currency" NOT NULL,
    "rate_to_base" DECIMAL(14,6) NOT NULL,
    "source" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rate_pkey" PRIMARY KEY ("rate_id")
);

-- CreateTable
CREATE TABLE "water_account" (
    "account_no" TEXT NOT NULL,
    "payer_id" INTEGER NOT NULL,
    "meter_no" TEXT NOT NULL,
    "meter_digits" INTEGER NOT NULL DEFAULT 5,
    "tariff_class" "TariffClass" NOT NULL,
    "status" "WaterAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_account_pkey" PRIMARY KEY ("account_no")
);

-- CreateTable
CREATE TABLE "meter_reading" (
    "reading_id" SERIAL NOT NULL,
    "meter_no" TEXT NOT NULL,
    "reading_date" DATE NOT NULL,
    "reading_value" INTEGER NOT NULL,
    "reading_type" "ReadingType" NOT NULL,
    "reading_flag" "ReadingFlag" NOT NULL DEFAULT 'NORMAL',
    "consumption_m3" INTEGER NOT NULL,
    "captured_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meter_reading_pkey" PRIMARY KEY ("reading_id")
);

-- CreateTable
CREATE TABLE "tariff" (
    "tariff_id" SERIAL NOT NULL,
    "tariff_class" "TariffClass" NOT NULL,
    "name" TEXT NOT NULL,
    "service_charge" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tariff_pkey" PRIMARY KEY ("tariff_id")
);

-- CreateTable
CREATE TABLE "tariff_band" (
    "band_id" SERIAL NOT NULL,
    "tariff_id" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "up_to_m3" INTEGER,
    "rate_per_m3" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "tariff_band_pkey" PRIMARY KEY ("band_id")
);

-- CreateTable
CREATE TABLE "billing_cycle" (
    "cycle_id" SERIAL NOT NULL,
    "billing_month" DATE NOT NULL,
    "status" "BillingCycleStatus" NOT NULL DEFAULT 'RUNNING',
    "bills_created" INTEGER NOT NULL DEFAULT 0,
    "bills_held" INTEGER NOT NULL DEFAULT 0,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "run_by" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "billing_cycle_pkey" PRIMARY KEY ("cycle_id")
);

-- CreateTable
CREATE TABLE "water_bill" (
    "bill_id" SERIAL NOT NULL,
    "account_no" TEXT NOT NULL,
    "billing_month" DATE NOT NULL,
    "cycle_id" INTEGER,
    "reading_id" INTEGER,
    "consumption_m3" INTEGER NOT NULL,
    "is_estimated" BOOLEAN NOT NULL DEFAULT false,
    "consumption_charge" DECIMAL(14,2) NOT NULL,
    "service_charge" DECIMAL(14,2) NOT NULL,
    "amount_billed" DECIMAL(14,2) NOT NULL,
    "previous_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "payments_received" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "arrears_brought_forward" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_due" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "due_date" DATE NOT NULL,
    "status" "WaterBillStatus" NOT NULL DEFAULT 'ISSUED',
    "is_abnormal" BOOLEAN NOT NULL DEFAULT false,
    "hold_reason" TEXT,
    "control_number" TEXT NOT NULL,
    "released_by" INTEGER,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "water_bill_pkey" PRIMARY KEY ("bill_id")
);

-- CreateTable
CREATE TABLE "journal_batch" (
    "batch_id" SERIAL NOT NULL,
    "business_date" DATE NOT NULL,
    "batch_type" "JournalBatchType" NOT NULL DEFAULT 'COLLECTION',
    "status" "JournalBatchStatus" NOT NULL DEFAULT 'PENDING',
    "total_debit" DECIMAL(16,2) NOT NULL,
    "total_credit" DECIMAL(16,2) NOT NULL,
    "fmis_reference" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "journal_batch_pkey" PRIMARY KEY ("batch_id")
);

-- CreateTable
CREATE TABLE "journal_line" (
    "line_id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "payment_id" INTEGER,
    "gl_code" TEXT NOT NULL,
    "revenue_code" TEXT,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,

    CONSTRAINT "journal_line_pkey" PRIMARY KEY ("line_id")
);

-- CreateTable
CREATE TABLE "channel_statement_line" (
    "line_id" SERIAL NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "statement_date" DATE NOT NULL,
    "external_ref" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "match_status" "ChannelMatchStatus",
    "payment_id" INTEGER,
    "imported_by" INTEGER,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_statement_line_pkey" PRIMARY KEY ("line_id")
);

-- CreateTable
CREATE TABLE "daily_summary" (
    "summary_date" DATE NOT NULL,
    "revenue_code" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "payment_count" INTEGER NOT NULL,
    "total_amount_base" DECIMAL(18,2) NOT NULL,
    "reversal_count" INTEGER NOT NULL DEFAULT 0,
    "refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summary_pkey" PRIMARY KEY ("summary_date","revenue_code","channel")
);

-- CreateTable
CREATE TABLE "alert" (
    "alert_id" SERIAL NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT NOT NULL,
    "acknowledged_by" INTEGER,
    "acknowledged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "notification" (
    "notification_id" SERIAL NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "related_type" TEXT,
    "related_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "audit_id" SERIAL NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_payer_id_key" ON "app_user"("payer_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_key" ON "role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permission_code_key" ON "permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payer_tin_key" ON "payer"("tin");

-- CreateIndex
CREATE INDEX "payer_phone_idx" ON "payer"("phone");

-- CreateIndex
CREATE INDEX "payer_email_idx" ON "payer"("email");

-- CreateIndex
CREATE INDEX "payer_national_id_idx" ON "payer"("national_id");

-- CreateIndex
CREATE INDEX "payer_full_name_idx" ON "payer"("full_name");

-- CreateIndex
CREATE INDEX "duplicate_flag_status_idx" ON "duplicate_flag"("status");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_flag_payer_id_matched_payer_id_match_field_key" ON "duplicate_flag"("payer_id", "matched_payer_id", "match_field");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_control_number_key" ON "assessment"("control_number");

-- CreateIndex
CREATE INDEX "assessment_payer_id_idx" ON "assessment"("payer_id");

-- CreateIndex
CREATE INDEX "assessment_status_due_date_idx" ON "assessment"("status", "due_date");

-- CreateIndex
CREATE INDEX "assessment_revenue_code_idx" ON "assessment"("revenue_code");

-- CreateIndex
CREATE UNIQUE INDEX "penalty_history_assessment_id_run_date_key" ON "penalty_history"("assessment_id", "run_date");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_target_revenue_code_period_month_key" ON "revenue_target"("revenue_code", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "payment_external_ref_key" ON "payment"("external_ref");

-- CreateIndex
CREATE INDEX "payment_payer_id_idx" ON "payment"("payer_id");

-- CreateIndex
CREATE INDEX "payment_assessment_id_idx" ON "payment"("assessment_id");

-- CreateIndex
CREATE INDEX "payment_bill_id_idx" ON "payment"("bill_id");

-- CreateIndex
CREATE INDEX "payment_status_created_at_idx" ON "payment"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_fmis_status_status_paid_at_idx" ON "payment"("fmis_status", "status", "paid_at");

-- CreateIndex
CREATE INDEX "payment_channel_paid_at_idx" ON "payment"("channel", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "reversal_payment_id_key" ON "reversal"("payment_id");

-- CreateIndex
CREATE INDEX "reversal_status_idx" ON "reversal"("status");

-- CreateIndex
CREATE INDEX "rejected_payment_created_at_idx" ON "rejected_payment"("created_at");

-- CreateIndex
CREATE INDEX "rejected_payment_external_ref_idx" ON "rejected_payment"("external_ref");

-- CreateIndex
CREATE INDEX "idempotency_key_created_at_idx" ON "idempotency_key"("created_at");

-- CreateIndex
CREATE INDEX "exchange_rate_currency_fetched_at_idx" ON "exchange_rate"("currency", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "water_account_meter_no_key" ON "water_account"("meter_no");

-- CreateIndex
CREATE INDEX "water_account_payer_id_idx" ON "water_account"("payer_id");

-- CreateIndex
CREATE UNIQUE INDEX "meter_reading_meter_no_reading_date_key" ON "meter_reading"("meter_no", "reading_date");

-- CreateIndex
CREATE INDEX "tariff_tariff_class_effective_from_idx" ON "tariff"("tariff_class", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_band_tariff_id_sort_order_key" ON "tariff_band"("tariff_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "billing_cycle_billing_month_key" ON "billing_cycle"("billing_month");

-- CreateIndex
CREATE UNIQUE INDEX "water_bill_control_number_key" ON "water_bill"("control_number");

-- CreateIndex
CREATE INDEX "water_bill_billing_month_idx" ON "water_bill"("billing_month");

-- CreateIndex
CREATE INDEX "water_bill_status_idx" ON "water_bill"("status");

-- CreateIndex
CREATE INDEX "water_bill_due_date_idx" ON "water_bill"("due_date");

-- CreateIndex
CREATE UNIQUE INDEX "water_bill_account_no_billing_month_key" ON "water_bill"("account_no", "billing_month");

-- CreateIndex
CREATE UNIQUE INDEX "journal_batch_fmis_reference_key" ON "journal_batch"("fmis_reference");

-- CreateIndex
CREATE INDEX "journal_batch_business_date_idx" ON "journal_batch"("business_date");

-- CreateIndex
CREATE INDEX "journal_batch_status_idx" ON "journal_batch"("status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_line_payment_id_key" ON "journal_line"("payment_id");

-- CreateIndex
CREATE INDEX "journal_line_batch_id_idx" ON "journal_line"("batch_id");

-- CreateIndex
CREATE INDEX "journal_line_gl_code_idx" ON "journal_line"("gl_code");

-- CreateIndex
CREATE INDEX "channel_statement_line_statement_date_idx" ON "channel_statement_line"("statement_date");

-- CreateIndex
CREATE UNIQUE INDEX "channel_statement_line_channel_statement_date_external_ref_key" ON "channel_statement_line"("channel", "statement_date", "external_ref");

-- CreateIndex
CREATE INDEX "daily_summary_revenue_code_summary_date_idx" ON "daily_summary"("revenue_code", "summary_date");

-- CreateIndex
CREATE UNIQUE INDEX "alert_dedupe_key_key" ON "alert"("dedupe_key");

-- CreateIndex
CREATE INDEX "alert_created_at_idx" ON "alert"("created_at");

-- CreateIndex
CREATE INDEX "notification_status_idx" ON "notification"("status");

-- CreateIndex
CREATE INDEX "notification_related_type_related_id_idx" ON "notification"("related_type", "related_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_hash_key" ON "audit_log"("hash");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log"("occurred_at");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payer"("payer_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role" ADD CONSTRAINT "role_parent_role_id_fkey" FOREIGN KEY ("parent_role_id") REFERENCES "role"("role_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permission"("permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "duplicate_flag_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payer"("payer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_flag" ADD CONSTRAINT "duplicate_flag_matched_payer_id_fkey" FOREIGN KEY ("matched_payer_id") REFERENCES "payer"("payer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payer"("payer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment" ADD CONSTRAINT "assessment_revenue_code_fkey" FOREIGN KEY ("revenue_code") REFERENCES "revenue_type"("revenue_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalty_history" ADD CONSTRAINT "penalty_history_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessment"("assessment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_target" ADD CONSTRAINT "revenue_target_revenue_code_fkey" FOREIGN KEY ("revenue_code") REFERENCES "revenue_type"("revenue_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payer"("payer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "assessment"("assessment_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "water_bill"("bill_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_revenue_code_fkey" FOREIGN KEY ("revenue_code") REFERENCES "revenue_type"("revenue_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal" ADD CONSTRAINT "reversal_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("payment_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal" ADD CONSTRAINT "reversal_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reversal" ADD CONSTRAINT "reversal_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_account" ADD CONSTRAINT "water_account_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payer"("payer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_reading" ADD CONSTRAINT "meter_reading_meter_no_fkey" FOREIGN KEY ("meter_no") REFERENCES "water_account"("meter_no") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariff_band" ADD CONSTRAINT "tariff_band_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "tariff"("tariff_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_bill" ADD CONSTRAINT "water_bill_account_no_fkey" FOREIGN KEY ("account_no") REFERENCES "water_account"("account_no") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_bill" ADD CONSTRAINT "water_bill_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "billing_cycle"("cycle_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "water_bill" ADD CONSTRAINT "water_bill_reading_id_fkey" FOREIGN KEY ("reading_id") REFERENCES "meter_reading"("reading_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "journal_batch"("batch_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("payment_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "app_user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

