# Part 1 · Technical Coding Questions

**Technology:** TypeScript (Node.js 24), PostgreSQL 17, Prisma 7, Redis + BullMQ, Next.js 16. All answers are running code used by the POC. General assumptions: [00-assumptions.md](00-assumptions.md) — payments come in USD or SOS and totals use `amount_base` (SOS); only `status = 'DONE'` payments count.

Try the SQL: `docker compose exec postgres psql -U ircub -d ircub`.

---

## Q1 · Quarterly collections per revenue type

- Running total: `SUM(total) OVER (PARTITION BY revenue_code ORDER BY quarter)`.
- Share of quarter: `100 × total / NULLIF(SUM(total) OVER (PARTITION BY quarter), 0)`.
- Financial year may start in any month (`p_fy_start_month`); quarter = `((month − start + 12) % 12) / 3 + 1`.
- Empty quarters show 0, so the running total never skips.

**Indexes for 50M rows**

| Index                                                               | Why                                            |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| `(paid_at, revenue_code) INCLUDE (amount_base) WHERE status='DONE'` | Range scan + index-only SUM; partial = smaller |
| BRIN on `paid_at`                                                   | Tiny index for time-ordered data               |
| Monthly range partitions (DDL example)                              | A year touches 12 partitions; easy archiving   |
| `daily_summary` table                                               | Dashboard reads ~33k rows, not 50M             |

- **Code:** [sql/01-quarterly-collections.sql](../sql/01-quarterly-collections.sql), [sql/02-indexes-and-partitioning.sql](../sql/02-indexes-and-partitioning.sql)
- **How to test:** `SELECT * FROM quarterly_collections(2025, 7);` · 1M rows: `pnpm --filter @ircub/db perf-data`

## Q2 · Collection efficiency and top 10 arrears

- **Efficiency** = collected ÷ billed × 100 per tariff class and month; `NULLIF` avoids ÷0. Billed and collected are summed **separately, then joined** (joining first would count a bill once per payment). Can exceed 100% when arrears are paid.
- **Arrears > 90 days** (payments clear the oldest bills first): `max(0, billed on bills due > 90 days ago − all payments)`.
- **Assumption:** the brief has no bill table, so `water_bill` was added.
- **Code:** [sql/03-collection-efficiency.sql](../sql/03-collection-efficiency.sql), [sql/04-top-10-arrears.sql](../sql/04-top-10-arrears.sql)
- **How to test:** `SELECT * FROM collection_efficiency('2025-10-01','2026-08-01');` · `SELECT * FROM top_water_arrears();`

## Q3 · Penalty calculation

Months 1–3: 5% per month, then 10% per month of the unpaid amount; simple interest, full months only; capped at 100% of `amount_due`. Provided as a PostgreSQL function **and** a TypeScript service (same results, tested).

**Idempotency:**

1. Recalculate the **total** and **SET** it (never add).
2. `UNIQUE (assessment_id, run_date)` + `ON CONFLICT DO NOTHING` on `penalty_history`.
3. One transaction with rows locked `FOR UPDATE`; an advisory lock serialises runs.

Assumption: a penalty already charged is never lowered by the job (paying the principal must not wipe it out).

- **Code:** [sql/05-penalty-procedure.sql](../sql/05-penalty-procedure.sql), [packages/core/src/penalty.ts](../packages/core/src/penalty.ts), [apps/worker/src/jobs/penalties.ts](../apps/worker/src/jobs/penalties.ts)
- **How to test:** `pnpm test` · `pnpm test:integration` (`penalty.test.ts`: second run changes nothing, SQL = TypeScript)

## Q4 · Water bill calculation

- Tiered tariff loaded from the `tariff` / `tariff_band` tables (not hard-coded): 31 m³ = 10×50 + 20×75 + 1×110 + 200 = **2,310**.
- Rollover: `(10^digits − previous) + current` (99,990 → 00,015 = 25 m³); a lower reading is rejected unless flagged `ROLLOVER` or `METER_REPLACEMENT`.
- Estimate = average of the last 3 **actual** readings; no history → exception, no bill.
- Money in integer cents.
- **Tests:** 0→200, 10→700, 11→775, 30→2,200, 31→2,310, rollover, replacement, rejected lower reading, estimates, no history, invalid tariffs.
- **Code:** [packages/core/src/tariff.ts](../packages/core/src/tariff.ts) (used by the billing cycle)
- **How to test:** `pnpm test` (`tariff.test.ts`)

## Q5 · Data validation & concurrency

- **Validation:** Zod for shape, then `validatePaymentRecords()`: amount > 0, payer exists, revenue code valid and active, `external_ref` unique (in the database and in the file). Rejected rows → `rejected_payment` with the reason.
- **Parallel processing:** one BullMQ queue per revenue category, each with a worker pool.
- **Never twice:** `UNIQUE (external_ref)` + `SELECT … FOR UPDATE SKIP LOCKED` + `PENDING → PROCESSING → DONE`, where DONE is set in the same transaction that applies the money. A sweeper recovers rows left by a crashed worker.
- **Code:** [payment-validation.ts](../packages/core/src/payment-validation.ts), [ingest.ts](../apps/web/src/modules/payments/services/ingest.ts), [process-payment.ts](../apps/worker/src/jobs/process-payment.ts)
- **How to test:** `pnpm test` · `pnpm test:integration` (`payment-processing.test.ts`: 4 workers race per payment, each applied once)

## Q6 · Payment Notification API

- `POST /api/payments/callback` (one notification) and `POST /api/payments/bulk` (JSON array).
- Signature: `HMAC-SHA256(secret, timestamp + "." + rawBody)`, compared with `timingSafeEqual`; older than 5 minutes → 401.
- `Idempotency-Key` stored first; same key again → the original response.
- Valid → `payment`; invalid → `rejected_payment`.
- Response: `{ received, accepted, rejected, errors: [{ row, reason }] }`.
- **OpenAPI:** [docs/api/openapi.yaml](../docs/api/openapi.yaml) (Swagger UI at `/api-docs`).
- **Code:** [app/api/payments](../apps/web/src/app/api/payments), [modules/payments/services](../apps/web/src/modules/payments/services), [hmac.ts](../packages/core/src/hmac.ts)
- **How to test:** `node scripts/send-signed.mjs bulk docs/api/examples/bulk-payments.json key1` (run twice) · `pnpm test:e2e` (`payment-api.spec.ts`)

## Q7 · FMIS posting

1. Per business day: credit each payment to its revenue type's GL, debit the collection bank GL.
2. Check debits = credits (in code and a database `CHECK`).
3. Post to the mock FMIS; store the FMIS reference.
4. Retry with exponential backoff, max 3 attempts, then `FAILED` for manual review (+ alert).
5. `UNIQUE (payment_id)` on `journal_line`: a payment is never posted twice.

**Reconciliation:** compare IRCUB totals with FMIS totals per day and GL code; a difference means not yet posted, a failed batch, or a real problem; drill down to the payments (`/fmis/reconciliation`).

- **Code:** [journal.ts](../packages/core/src/journal.ts), [fmis-posting.ts](../apps/worker/src/jobs/fmis-posting.ts)
- **How to test:** `pnpm test:integration` (`fmis-posting.test.ts`: success, retry, FAILED, no double posting)

## Q8 · Caching

- **Cache-aside** in Redis, key `summary:{revenue_code}:{date}`, TTL 5 minutes.
- The worker **deletes the matching key** when it posts a payment.
- **Trade-offs:** simple and precise, caches only what is read; the first read after a change is a miss; a short race window is bounded by the TTL; if Redis is down, reports fall back to the database.
- **Code:** [cache.ts](../packages/platform/src/cache.ts), [revenue-summary.ts](../apps/web/src/modules/dashboard/services/revenue-summary.ts)
- **How to test:** call `GET /api/reports/revenue-summary` twice (see `cache.hits`) · `pnpm test:integration` (`cache.test.ts`)

## Q9 · Multi-step payment capture form

1. Search the payer by TIN, phone or water account; choose the revenue type (and assessment / bill).
2. Payment lines: amount, currency, channel, external reference.
3. Submit → confirmation with errors per line and a printable receipt; statuses turn DONE live.

The **same Zod schema** validates in the browser and in the server action. Tablet-friendly (large touch targets, numeric keyboards).

- **Code:** [capture-form.tsx](../apps/web/src/modules/payments/components/capture-form.tsx), [capture-actions.ts](../apps/web/src/modules/payments/actions/capture-actions.ts)
- **How to test:** sign in as `officer@ircub.test` → _Capture payment_ · `pnpm test:e2e` (`capture.spec.ts`, desktop + tablet)
