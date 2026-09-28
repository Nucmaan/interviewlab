# Entity Relationship Diagram

Source of truth: [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) plus the raw SQL constraints in
[`packages/db/prisma/migrations/20260928000100_constraints_and_guards`](../packages/db/prisma/migrations/20260928000100_constraints_and_guards/migration.sql).
Tables from the brief are `payer`, `revenue_type`, `assessment`, `payment`, `water_account` and `meter_reading`; every other table is an addition explained in [`answers/00-assumptions.md`](../answers/00-assumptions.md#c-schema-additions-to-the-briefs-tables).

The diagram is split into three views so it stays readable.

## 1. Registry, revenue and payments

```mermaid
erDiagram
    payer ||--o{ assessment : "is assessed"
    payer ||--o{ payment : "pays"
    payer ||--o{ water_account : "owns"
    payer ||--o{ duplicate_flag : "may duplicate"
    revenue_type ||--o{ assessment : "classifies"
    revenue_type ||--o{ payment : "classifies"
    revenue_type ||--o{ revenue_target : "has targets"
    assessment ||--o{ payment : "is paid by"
    assessment ||--o{ penalty_history : "accrues"
    payment ||--o| reversal : "may be reversed by"
    payment ||--o| journal_line : "posted as"

    payer {
        int payer_id PK
        enum payer_type "INDIVIDUAL | BUSINESS"
        text full_name
        text tin UK
        text national_id
        text phone
        text email
        timestamp created_at
    }
    revenue_type {
        text revenue_code PK
        text name
        enum category "TAX | WATER"
        text gl_code "GL mapping for FMIS"
        bool is_active
        numeric default_amount
    }
    assessment {
        int assessment_id PK
        int payer_id FK
        text revenue_code FK
        numeric amount_due
        numeric amount_paid
        numeric penalty_amount "SET by penalty job"
        date due_date
        enum status "OPEN | PART_PAID | PAID"
        text control_number UK "AS-YYYY-NNNNNNN-C"
    }
    penalty_history {
        int penalty_history_id PK
        int assessment_id FK
        date run_date "UNIQUE with assessment_id"
        int months_overdue
        numeric unpaid_amount
        numeric penalty_amount
    }
    payment {
        int payment_id PK
        int payer_id FK
        int assessment_id FK
        int bill_id FK
        text revenue_code FK
        numeric amount
        enum currency "USD | SOS"
        numeric exchange_rate
        numeric amount_base "SOS"
        enum channel "BANK | MOBILE_MONEY | CASH"
        text external_ref UK
        timestamp paid_at
        enum status "PENDING > PROCESSING > DONE"
        enum fmis_status
    }
    reversal {
        int reversal_id PK
        int payment_id FK,UK
        int requested_by FK
        int decided_by FK "CHECK <> requested_by"
        enum status
    }
    duplicate_flag {
        int flag_id PK
        int payer_id FK
        int matched_payer_id FK
        enum match_field "PHONE | EMAIL | NATIONAL_ID"
        enum status
    }
    revenue_target {
        int target_id PK
        text revenue_code FK
        date period_month
        numeric target_amount
    }
```

## 2. Water utility

```mermaid
erDiagram
    payer ||--o{ water_account : "owns"
    water_account ||--o{ meter_reading : "meter_no"
    water_account ||--o{ water_bill : "is billed"
    tariff ||--|{ tariff_band : "has bands"
    billing_cycle ||--o{ water_bill : "produces"
    meter_reading ||--o{ water_bill : "is billed on"
    water_bill ||--o{ payment : "is paid by"

    water_account {
        text account_no PK
        int payer_id FK
        text meter_no UK
        int meter_digits "for rollover"
        enum tariff_class "DOMESTIC | COMMERCIAL | INSTITUTIONAL"
        enum status
    }
    meter_reading {
        int reading_id PK
        text meter_no FK
        date reading_date "UNIQUE with meter_no"
        int reading_value
        enum reading_type "ACTUAL | ESTIMATED"
        enum reading_flag "NORMAL | ROLLOVER | METER_REPLACEMENT"
        int consumption_m3
    }
    tariff {
        int tariff_id PK
        enum tariff_class
        numeric service_charge
        date effective_from
    }
    tariff_band {
        int band_id PK
        int tariff_id FK
        int sort_order
        int up_to_m3 "NULL = no upper limit"
        numeric rate_per_m3
    }
    billing_cycle {
        int cycle_id PK
        date billing_month UK
        enum status
        jsonb exceptions "exception report"
    }
    water_bill {
        int bill_id PK
        text account_no FK
        date billing_month "UNIQUE with account_no"
        int consumption_m3
        numeric amount_billed "current month only"
        numeric arrears_brought_forward
        numeric total_due
        numeric amount_paid
        date due_date
        enum status "HELD | ISSUED | PART_PAID | PAID | CARRIED_FORWARD"
        text control_number UK "WB-YYYY-NNNNNNN-C"
    }
```

## 3. Security, FMIS, reporting and integration

```mermaid
erDiagram
    app_user ||--o{ user_role : "has"
    role ||--o{ user_role : "granted to"
    role ||--o{ role_permission : "has"
    permission ||--o{ role_permission : "granted by"
    role ||--o{ role : "parent of"
    app_user ||--o{ audit_log : "acts in"
    app_user |o--o| payer : "self-service link"
    journal_batch ||--|{ journal_line : "contains"
    payment ||--o| journal_line : "UNIQUE payment_id"

    app_user {
        int user_id PK
        text email UK
        text password_hash "argon2id"
        bool is_active
        bool totp_enabled
        int failed_login_count
        timestamp locked_until
        int payer_id FK,UK
    }
    role {
        int role_id PK
        text code UK
        int parent_role_id FK "hierarchy"
        bool is_system
    }
    permission {
        int permission_id PK
        text code UK
        text module
    }
    audit_log {
        int audit_id PK
        timestamp occurred_at
        int actor_user_id FK
        text action
        text entity_type
        text entity_id
        jsonb before
        jsonb after
        text prev_hash
        text hash UK "SHA256(prev_hash + row)"
    }
    journal_batch {
        int batch_id PK
        date business_date
        enum status "PENDING | POSTED | FAILED | REVERSED"
        numeric total_debit "CHECK = total_credit"
        numeric total_credit
        text fmis_reference UK
        int attempts
    }
    journal_line {
        int line_id PK
        int batch_id FK
        int payment_id FK,UK
        text gl_code
        numeric debit
        numeric credit
    }
    daily_summary {
        date summary_date PK
        text revenue_code PK
        enum channel PK
        int payment_count
        numeric total_amount_base
        int reversal_count
    }
    alert {
        int alert_id PK
        enum alert_type
        enum severity
        text dedupe_key UK
    }
    exchange_rate {
        int rate_id PK
        enum currency
        numeric rate_to_base
        timestamp fetched_at
    }
    idempotency_key {
        text key PK
        text request_hash
        int response_status
        jsonb response_body
    }
    rejected_payment {
        int rejected_id PK
        enum source
        int row_number
        text external_ref
        jsonb payload
        text reason
    }
    channel_statement_line {
        int line_id PK
        enum channel
        date statement_date
        text external_ref
        numeric amount
        enum match_status
    }
    notification {
        int notification_id PK
        enum channel "SMS | EMAIL"
        text recipient
        enum status
    }
    system_config {
        text key PK
        jsonb value
    }
```

## Integrity rules enforced by the database

| Rule                                                          | How                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TIN is unique                                                 | `UNIQUE (tin)`                                                                                         |
| A channel reference is only ever received once                | `UNIQUE (external_ref)` on `payment`                                                                   |
| A payment is posted to FMIS at most once                      | `UNIQUE (payment_id)` on `journal_line`                                                                |
| One penalty history row per assessment per day                | `UNIQUE (assessment_id, run_date)`                                                                     |
| One bill per account per month; one reading per meter per day | `UNIQUE (account_no, billing_month)`, `UNIQUE (meter_no, reading_date)`                                |
| Requester cannot approve their own reversal                   | `CHECK (decided_by IS NULL OR decided_by <> requested_by)`                                             |
| Journals balance                                              | `CHECK (total_debit = total_credit)`; each line is debit **or** credit                                 |
| Positive money                                                | `CHECK (amount > 0 AND amount_base > 0)`, `CHECK (amount_due > 0 ...)`, `penalty_amount <= amount_due` |
| Audit log is append-only                                      | `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers raise an error                                |
