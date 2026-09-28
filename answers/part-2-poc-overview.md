# Part 2 · Proof of Concept — overview

**Technology:** TypeScript · Next.js 16 (App Router, React 19) · PostgreSQL 17 · Prisma 7 · Redis 8 + BullMQ 5 · Auth.js v5 · Tailwind CSS · Recharts · Docker Compose. Architecture and reasons: [`docs/architecture.md`](../docs/architecture.md). Plain-English walkthrough of every flow: [`docs/how-it-works.md`](../docs/how-it-works.md).

**Run it:** `cp .env.example .env && docker compose up --build`, then open <http://localhost:3000> (demo logins in the [README](../README.md#demo-logins)).

External systems (banks, mobile money, exchange rates, FMIS, SMS/email) are simulated by `apps/mock-services`, with a configurable failure rate and delay so retries and failures can be demonstrated.

---

## POC objectives

| Objective in the brief           | How the POC meets it                                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High-volume transactions         | Bulk API (10,000 rows/request), validation in a few bulk queries, per-category BullMQ queues and worker pools, `FOR UPDATE SKIP LOCKED`; k6 test at 5,000 payments/minute: 0% errors, p95 281 ms, all processed within the minute. Pre-aggregated `daily_summary` for reporting; 1M+ row generator. |
| Real-time payment updates        | Worker publishes events to Redis pub/sub → `/api/events` Server-Sent Events → receipts, portal, dashboard and lists update live.                                                                                                                                                                    |
| Complex user roles and workflows | Database-driven RBAC with role hierarchy and custom roles; four-eyes reversals; billing hold/release; FMIS retry/reverse; duplicate review.                                                                                                                                                         |
| Automated posting to FMIS        | Nightly (and on-demand) balanced journals with retries, `FAILED` manual review, reversal journals and reconciliation.                                                                                                                                                                               |

## Module-by-module

### 1. User & Role Management

| Requirement                                         | Where                                                                                                          | See it                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Six roles with the brief's permissions              | `packages/core/src/permissions.ts` (catalogue + defaults), seeded into `role`, `permission`, `role_permission` | Sign in as each demo user — each gets a different menu                     |
| Hierarchical roles                                  | `role.parent_role_id`; `resolvePermissions()` in `packages/core/src/access-control.ts`                         | _Roles & permissions_ → Revenue Supervisor shows "(inherited)" permissions |
| Permissions configurable in the DB; custom roles    | `/admin/roles`, `/admin/roles/[id]` (permission matrix), `modules/users/services/user-admin.ts`                | Create a role, tick permissions, assign it to a user                       |
| Segregation of duties                               | `assertCanApprove()` + DB `CHECK (decided_by <> requested_by)`                                                 | _Reversals_: the requester sees "another supervisor must decide"           |
| Secure login/logout, password policy, optional 2FA  | Auth.js (`lib/auth`), argon2id, lockout, TOTP (`modules/users/services`)                                       | _Security_ page → set up 2FA; 5 wrong passwords → lockout                  |
| Role-based menus, dashboards and API access control | `lib/navigation.ts`, `lib/rbac.ts` (`requirePermission`, `withPermission`, `createAction`)                     | Officer opening `/admin/users` → "no access"; API returns 401/403          |

### 2. Taxpayer & Customer Registry

| Requirement                                                       | Where                                                                                     | See it                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Individuals and businesses with unique TIN                        | `payer.tin UNIQUE`; `modules/registry`                                                    | _Payers → Register payer_; the same TIN twice is refused |
| One payer → many obligations, water accounts, meters              | `assessment.payer_id`, `water_account.payer_id`                                           | Payer profile                                            |
| Duplicate detection (phone, email, national ID) → flag for review | `packages/core/src/duplicates.ts` (normalisation), `duplicate_flag`, `/payers/duplicates` | Register with an existing phone written as `061…`        |
| 360° view: assessments, bills, payments, balance                  | `/payers/[id]`, `getPayerProfile()`                                                       | Open any payer                                           |

### 3. Tax Revenue Assessment & Collection

| Requirement                                                     | Where                                                                                                                                                                                 | See it                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Revenue types with rates and GL codes                           | `revenue_type` (`default_amount`, `gl_code`), `/revenue/types`                                                                                                                        | Admin can edit                                   |
| Assessments with unique control numbers                         | PostgreSQL sequence + Luhn check digit (`packages/core/src/control-number.ts`)                                                                                                        | _Assessments → Create_ → `AS-2026-NNNNNNN-C`     |
| CSV bulk uploader: validate before saving, report               | `/revenue/upload`, `modules/revenue/services/csv-upload.ts`; live browser validation with the same schemas                                                                            | Upload a CSV → preview → report with reasons     |
| Audit tracking with before/after, tamper-evident separate table | `audit_log` (append-only trigger, SHA-256 hash chain), `/audit`                                                                                                                       | _Audit log → Verify chain_; `tamper-demo` script |
| Advanced filters                                                | Payments: payer, revenue type, amount range, channel, status, dates, reference; Assessments: payer, type, status, amount, due dates, control number — all server-side with pagination | `/payments`, `/revenue/assessments`              |

### 4. Water Utility Billing

| Requirement                                                                              | Where                                                                   | See it                                          |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| Readings individually and via CSV; lower readings rejected unless rollover / replacement | `/water/readings`, `calculateConsumption()`                             | Enter a lower reading → explained rejection     |
| Monthly billing cycle: tiered tariff, arrears carried forward, payments applied          | `apps/worker/src/jobs/billing.ts` (`calculateWaterBill`, `composeBill`) | _Billing cycles → Run_                          |
| PDF bill + mock SMS/email                                                                | `bill-pdf.ts` (with QR code), notifications outbox → mock gateway       | PDF links; `GET http://localhost:4000/messages` |
| Abnormal consumption (> 200% of 3-month average) held before release                     | `isAbnormalConsumption()`, bill status `HELD`, _Release_ button         | Cycle detail page                               |
| Exception report; customer statement with running balance                                | `/water/billing/[id]`, `/water/accounts/[no]` (`buildStatement()`)      | Both pages print cleanly                        |

### 5. Payment Channel Integration

| Requirement                                                                     | Where                                                                                       | See it                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Mock bank and mobile money APIs; USD and SOS                                    | `apps/mock-services`; `payment.currency`, `exchange_rate`, `amount_base`                    | Capture a USD line                                         |
| Dynamic rates from a separate mock API                                          | Worker fetches `GET /rates` every 15 min into `exchange_rate`                               | `exchange_rate` table / payment detail shows the rate used |
| Initiate / receive payment; verify callback; update payment and assessment/bill | Portal → `POST /payments` on the mock → signed callback → `/api/payments/callback` → worker | Sign in as `taxpayer@ircub.test` → _Pay with mobile money_ |
| Retry failed status checks 3 times → permanently failed + notify supervisor     | `apps/worker/src/jobs/payment-status.ts`                                                    | Mock `callbackDropRate` / `failureRate`                    |
| Daily channel reconciliation report vs statement file                           | `/payments/reconciliation`, `reconcileChannelStatement()`                                   | Reconcile today's mobile money                             |

### 6. FMIS Posting & Reconciliation

| Requirement                                                       | Where                                                                  | See it                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| Configurable revenue type → GL mapping                            | `revenue_type.gl_code`, `system_config.collection_bank_gl`             | _Revenue types & GL codes_     |
| Daily journal batches; statuses Pending, Posted, Failed, Reversed | `journal_batch`, `apps/worker/src/jobs/fmis-posting.ts`                | `/fmis` (post, retry, reverse) |
| Post to mock FMIS, store reference, never post a payment twice    | `UNIQUE(payment_id)` on `journal_line`, batch reference dedupe in FMIS | Batch detail                   |
| Reconciliation screen per GL code and day with drill-down         | `/fmis/reconciliation`                                                 | Click a GL code                |

### 7. Dashboard with Predictive Analytics

| Requirement                                                      | Where                                                                                                                  | See it                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Trends by revenue type and channel (line charts)                 | `/dashboard`, `modules/dashboard`                                                                                      | —                                                                    |
| Collections vs targets; water billed vs collected                | `revenue_target`, `collection_efficiency()`                                                                            | —                                                                    |
| Next-quarter prediction (linear regression or better, justified) | `packages/core/src/regression.ts`: linear regression **and** trend × seasonal factor (justified: January licence peak) | Forecast card explains both and their limits                         |
| Real-time alerts (collection drop, reversal spike)               | `apps/worker/src/jobs/summaries.ts` + `alert` + SSE                                                                    | `/alerts`; header shows the latest alert live                        |
| Server-side processing, pre-aggregated data, async updates       | `daily_summary` refreshed by the worker; SSE                                                                           | _Demo: simulate 20 mobile money payments_ — watch the numbers change |

## POC submission deliverables

| Deliverable                                          | Location                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source code with meaningful commit history           | This repository (`git log`)                                                                                                                                            |
| README: setup, stack, assumptions, known limitations | [`README.md`](../README.md), [`00-assumptions.md`](00-assumptions.md)                                                                                                  |
| ERD and seed/test data scripts                       | [`docs/erd.md`](../docs/erd.md), `packages/db/scripts/seed.ts`, `perf-data.ts`                                                                                         |
| API documentation + Postman collection               | [`docs/api/openapi.yaml`](../docs/api/openapi.yaml) (Swagger UI at `/api-docs`), [`docs/api/ircub.postman_collection.json`](../docs/api/ircub.postman_collection.json) |
| Automated tests and how to run them                  | `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `tests/load/payments-peak.js` (see README)                                                                      |
| Deployment option                                    | Docker Compose (one command)                                                                                                                                           |
| Bonus                                                | QR code on water bills (Part 4.4)                                                                                                                                      |
