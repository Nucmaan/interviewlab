# Part 1 · Technical Coding Questions

**Technology used for every answer:** TypeScript (Node.js 24), PostgreSQL 17, Prisma 7, Redis 8 + BullMQ 5, Next.js 16 (React 19). All answers are real, running code in this repository and are used by the POC — nothing is duplicated between the answer and the POC.

Assumptions that apply to all answers are in [`00-assumptions.md`](00-assumptions.md). The most important ones:

- Payments arrive in **USD or SOS**; totals are always added in the base currency **SOS** (`payment.amount_base`).
- Only payments with `status = 'DONE'` count as collections (failed and reversed payments are excluded).
- Extra columns and tables added to the brief's schema are listed, with reasons, in [section C of the assumptions](00-assumptions.md#c-schema-additions-to-the-briefs-tables).

Quick way to try the SQL: start the stack (`cp .env.example .env && docker compose up --build`), then
`docker compose exec postgres psql -U ircub -d ircub` and run the `SELECT` shown under each answer.

---

## Database & SQL

### Q1 · Advanced SQL query: quarterly collections per revenue type

**Answer.** A PostgreSQL function that returns, for each revenue type and quarter of a financial year: the total collected, the running total up to that quarter, and the share of the quarter.

- **Running total** — `SUM(total) OVER (PARTITION BY revenue_code ORDER BY quarter)`: add up this revenue type's quarters in order.
- **Share of quarter** — `100 × total / SUM(total) OVER (PARTITION BY quarter)`, with `NULLIF(..., 0)` so an empty quarter gives NULL instead of a division-by-zero error.
- **Financial year that does not start in January** — parameter `p_fy_start_month`. The quarter is `((month − start_month + 12) % 12) / 3 + 1`. FY2025 with a July start = 1 Jul 2025 – 30 Jun 2026.
- A revenue type with collections in the year appears in all 4 quarters (0 when nothing was collected), so the running total never skips a quarter (a `CROSS JOIN generate_series(1,4)` grid, then `LEFT JOIN`).
- The date filter is a plain range on `paid_at` (`>= start AND < end`), not a function of `paid_at`, so an index on `paid_at` can be used.

```sql
SELECT * FROM quarterly_collections(2025);      -- calendar year 2025
SELECT * FROM quarterly_collections(2025, 7);   -- FY Jul 2025 – Jun 2026
```

**Indexes for 50 million payments** (in `sql/02-indexes-and-partitioning.sql`):

| Layer | What                                                                                              | Why                                                                                                                                                                                                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `CREATE INDEX ... ON payment (paid_at, revenue_code) INCLUDE (amount_base) WHERE status = 'DONE'` | `paid_at` first narrows the scan to one year; `revenue_code` helps grouping; `INCLUDE amount_base` lets PostgreSQL answer the `SUM` from the index alone (index-only scan) without reading the 50M-row table; the partial `WHERE status = 'DONE'` keeps failed/reversed rows out, so the index is smaller.            |
| 2     | `BRIN (paid_at)`                                                                                  | Payments are inserted roughly in time order, so a BRIN index (min/max per block range) is a few hundred KB instead of gigabytes, and is ideal for wide date-range scans.                                                                                                                                              |
| 3     | Monthly **range partitioning** on `paid_at`                                                       | A one-year query touches only 12 partitions (partition pruning); old years can be detached and archived. Example DDL on a demo table in the same file; not applied to the Prisma-managed table (a partitioned table cannot have `UNIQUE(external_ref)` without the partition key — the file explains the workaround). |
| 4     | Pre-aggregated **`daily_summary`** table (day × revenue type × channel)                           | ~33,000 rows instead of 50,000,000. The dashboard reads only this table; the worker refreshes it with `refresh_daily_summary()`.                                                                                                                                                                                      |

In production, indexes are created with `CREATE INDEX CONCURRENTLY` so writes are not blocked; verify plans with `EXPLAIN (ANALYZE, BUFFERS)`.

- **Code:** [`sql/01-quarterly-collections.sql`](../sql/01-quarterly-collections.sql), [`sql/02-indexes-and-partitioning.sql`](../sql/02-indexes-and-partitioning.sql). Used by the dashboard: `apps/web/src/modules/dashboard/services/reports.ts`.
- **How to test:** run the `SELECT`s above. For a performance test: `pnpm --filter @ircub/db perf-data` inserts 1,000,000 extra payments and prints `EXPLAIN ANALYZE` of the quarterly aggregation (`pnpm --filter @ircub/db perf-data -- --cleanup` removes them).

---

### Q2 · Collection efficiency and top 10 arrears

**(a) Collection efficiency per tariff class and billing month** — billed, collected, `collected / billed × 100`.

- The brief has no bill table, so `water_bill` was added. **Billed** = `amount_billed` (this month's charges only; arrears carried forward are not billed twice). HELD and CANCELLED bills are excluded (not sent to customers).
- **Collected** = successful payments against the bills of that month.
- The billed and collected totals are **aggregated separately and then joined**. Joining bills to payments first and then summing `amount_billed` would count a bill once per payment (a bill paid in 3 instalments would be "billed" 3 times) — the classic fan-out mistake.
- `NULLIF(billed, 0)` avoids division by zero. Efficiency can exceed 100% in months where customers pay off old arrears.

```sql
SELECT * FROM collection_efficiency(date '2025-10-01', date '2026-08-01');
```

**(b) Top 10 accounts by arrears older than 90 days**

- Payments settle the **oldest** charges first (FIFO), so: `arrears_over_90 = max(0, billed on bills due more than 90 days ago − everything paid so far)`.
- Ties are broken by account number; `FETCH FIRST 10 ROWS WITH TIES` is mentioned as the alternative.

```sql
SELECT * FROM top_water_arrears();                        -- as of today
SELECT * FROM top_water_arrears(date '2026-06-30', 20);   -- as of a date, top 20
```

- **Code:** [`sql/03-collection-efficiency.sql`](../sql/03-collection-efficiency.sql), [`sql/04-top-10-arrears.sql`](../sql/04-top-10-arrears.sql). Used by the dashboard (water billed vs collected).
- **How to test:** run the `SELECT`s above against the seeded data (≈10,000 bills over 2 years).

---

### Q3 · Penalty calculation

**Rules implemented:** months 1–3 overdue at 5% of the unpaid amount per month, month 4 onwards at 10% per month, simple interest, **full months only** (PostgreSQL `age()`), capped at **100% of the original `amount_due`**. Rates and cap are read from `system_config('penalty_rules')` with the brief's values as defaults.

It is provided **twice**, as the brief allows either:

1. **Stored function** `apply_overdue_penalties(run_date)` in PL/pgSQL.
2. **Application service** — the pure rule `calculatePenalty()` in `packages/core` (unit tested) used by the worker's daily job.

**How idempotency is guaranteed (running twice on the same day never double-charges):**

1. The **total** penalty is recalculated from scratch and **SET** on the assessment — never `penalty_amount = penalty_amount + x`. The second run computes the same total again.
2. `penalty_history` has **`UNIQUE (assessment_id, run_date)`** and the insert uses **`ON CONFLICT DO NOTHING`** (Prisma: `skipDuplicates`). A second run adds no history rows.
3. Everything runs in **one transaction** with the assessments locked `FOR UPDATE`: all updates and history rows are saved together, or none are.
4. An **advisory lock** makes two simultaneous runs wait for each other.

One more rule (stated in assumption D5): a penalty already charged is **never lowered** by the job (`GREATEST(current, recalculated)`), otherwise paying the principal would make the recalculated penalty drop to zero and wipe out a penalty still owed.

```sql
SELECT * FROM apply_overdue_penalties(current_date);  -- run it twice: the second returns 0, 0
```

| Example (amount_due 1,000, nothing paid) | Months | Penalty                     |
| ---------------------------------------- | ------ | --------------------------- |
| due 1 Jan, run 31 Jan                    | 0      | 0                           |
| run 1 Apr                                | 3      | 150 (3 × 5%)                |
| run 1 Jun                                | 5      | 350 (3 × 5% + 2 × 10%)      |
| run 1 Jan next year                      | 12     | 1,000 (105% capped at 100%) |

- **Code:** [`sql/05-penalty-procedure.sql`](../sql/05-penalty-procedure.sql), [`packages/core/src/penalty.ts`](../packages/core/src/penalty.ts), [`apps/worker/src/jobs/penalties.ts`](../apps/worker/src/jobs/penalties.ts).
- **How to test:** `pnpm test` (unit tests in `penalty.test.ts`); `pnpm test:integration` runs the SQL function and the worker job on the test database, checks that running twice changes nothing, and that both give identical results (`tests/integration/penalty.test.ts`).

---

## Backend Programming

### Q4 · Water bill calculation

- **Tiered (block) tariff:** each band's rate applies only to the units inside that band. Domestic: 0–10 m³ at 50, 11–30 m³ at 75, above 30 at 110, plus 200 service charge. Example: 31 m³ = 10×50 + 20×75 + 1×110 + 200 = **2,310**.
- **Configuration, not code:** bands come from the `tariff` and `tariff_band` tables (each band stores its upper limit `up_to_m3`; NULL = no limit). The function receives them as data and validates them (limits increase, last band open-ended, no negative rates).
- **Rollover:** `(10^digits − previous) + current`, e.g. 5-digit meter 99,990 → 00,015 = **25 m³**. A lower reading is only accepted when flagged `ROLLOVER` or `METER_REPLACEMENT` (new meter starts at 0); otherwise an `InvalidReadingError` is thrown — silently accepting it would under-bill the customer.
- **Estimated reading:** rounded average of the last 3 **ACTUAL** consumptions (never based on earlier estimates, so errors do not compound). No actual history → `null`, and the billing cycle puts the account on the exception report instead of guessing.
- **Money is exact:** calculated in integer cents.

**Unit tests (more than the five required):** 0 → 200, 1 → 250, 10 → 700, 11 → 775, 30 → 2,200, 31 → 2,310, 45 → 3,850, rollover 99,990 → 15 = 25, meter replacement, rejected lower reading, rollover flag on a higher reading, reading too large for the meter, estimate from the last 3 actual readings ignoring estimates, fewer than 3 readings, no history, zero history, custom commercial tariff, broken tariff configurations.

- **Code:** [`packages/core/src/tariff.ts`](../packages/core/src/tariff.ts) (used by the billing cycle `apps/worker/src/jobs/billing.ts` and by the seed).
- **How to test:** `pnpm test` → `packages/core/src/tariff.test.ts`.

---

### Q5 · Data validation & concurrency

**Validation.** Two layers:

1. **Shape** with Zod at the edge (types, required fields, at most 2 decimals, reference format) — per row, so one bad row never fails the whole file.
2. **Business rules** in the pure function `validatePaymentRecords()`: amount > 0, payer exists, revenue code exists **and is active**, `external_ref` unique (against the database **and** inside the same upload), not dated in the future, and — if given — the assessment/bill belongs to that payer. Reference data is loaded in 5 bulk queries (not one query per row), so a 10,000-row file stays fast.

Rejected rows are written to **`rejected_payment`** with the row number and reason (visible on the _Rejected records_ screen), separately from successful payments.

**Parallel processing without double processing.** Valid payments are stored as `PENDING` and queued in BullMQ — **one queue per revenue category** (`payments-tax`, `payments-water`), each with a pool of concurrent workers (8 by default; more worker containers can be added). A payment is never processed twice because three mechanisms work together:

| Mechanism                                                                       | What it prevents                                                                                                                                                            |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNIQUE (external_ref)` on `payment`, and inserts with `ON CONFLICT DO NOTHING` | The same channel payment being **stored** twice, even when two requests race.                                                                                               |
| `SELECT ... FOR UPDATE SKIP LOCKED` in the claim step                           | Two workers **claiming** the same row at the same moment: one gets it, the other skips it immediately.                                                                      |
| `PENDING → PROCESSING → DONE` with conditional updates                          | Re-processing a finished payment: the claim only matches `status = 'PENDING'`; the money is applied and `DONE` is set **in one transaction** `WHERE status = 'PROCESSING'`. |

Extra safety: the BullMQ job id is `payment-<id>` (a duplicate job is ignored); assessment/bill rows are locked `FOR UPDATE` while `amount_paid` changes; a maintenance job returns rows stuck in `PROCESSING` (crashed worker) to `PENDING` after 5 minutes — safe, because `DONE` was never committed — and re-queues old `PENDING` rows whose job was lost.

```mermaid
sequenceDiagram
    participant API as API / capture form
    participant DB as PostgreSQL
    participant Q as BullMQ (per category)
    participant W1 as Worker A
    participant W2 as Worker B
    API->>DB: INSERT payment (PENDING) ON CONFLICT (external_ref) DO NOTHING
    API->>DB: INSERT rejected_payment (reason)
    API->>Q: add job payment-42
    Q->>W1: payment-42
    Q-->>W2: payment-42 (duplicate delivery)
    W1->>DB: UPDATE ... SET PROCESSING WHERE id=42 AND PENDING (FOR UPDATE SKIP LOCKED)
    W2->>DB: same claim → 0 rows (skipped)
    W1->>DB: BEGIN; lock assessment; apply amount; SET DONE WHERE PROCESSING; audit; COMMIT
```

- **Code:** [`packages/core/src/payment-validation.ts`](../packages/core/src/payment-validation.ts), [`apps/web/src/modules/payments/services/ingest.ts`](../apps/web/src/modules/payments/services/ingest.ts), [`apps/worker/src/jobs/process-payment.ts`](../apps/worker/src/jobs/process-payment.ts), [`apps/worker/src/jobs/maintenance.ts`](../apps/worker/src/jobs/maintenance.ts), queues in [`packages/platform/src/queues.ts`](../packages/platform/src/queues.ts).
- **How to test:** `pnpm test` (validation rules); `pnpm test:integration` → `tests/integration/payment-processing.test.ts` runs 20 concurrent processors on the same payments and asserts each is applied exactly once.

---

### Q6 · Payment Notification API

| Endpoint                      | Purpose                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/payments/callback` | One notification from a bank / mobile money provider. Confirms a payment IRCUB initiated, or records a payment made with a control number. |
| `POST /api/payments/bulk`     | A JSON array of up to 10,000 payment records.                                                                                              |

Each request goes through: **rate limit** (Redis, per IP) → **HMAC signature** → **idempotency key** → **validation** → **processing** → **summary response**.

- **Signature:** `X-Signature = hex(HMAC-SHA256(secret, X-Timestamp + "." + rawBody))`. The **raw** body is signed (any byte change breaks it); comparison uses `crypto.timingSafeEqual` (no timing leak); requests more than **5 minutes** old (or in the future) are rejected — stops replays of captured requests.
- **Idempotency:** the `Idempotency-Key` header is required. The key is **claimed first** (`INSERT ... ON CONFLICT DO NOTHING` into `idempotency_key`) so two identical requests at the same moment cannot both run. Same key + same body again → the **original response** is returned (header `Idempotent-Replayed: true`); same key + different body → 422; still running → 409. Keys are kept 7 days.
- **Successful and failed transactions are stored separately:** valid payments in `payment`, invalid rows and declined callbacks in `rejected_payment`.
- **Response:** `{ received, accepted, rejected, errors: [{ row, reason }] }`.
- **OpenAPI:** [`docs/api/openapi.yaml`](../docs/api/openapi.yaml), browsable at <http://localhost:3000/api-docs>; Postman collection in `docs/api/ircub.postman_collection.json`.

Example (from the running system):

```json
{
  "received": 6,
  "accepted": 2,
  "rejected": 4,
  "errors": [
    { "row": 3, "reason": "Payer 99999 does not exist" },
    { "row": 4, "reason": "Revenue code ROAD is not active" },
    { "row": 5, "reason": "amount: Amount must be greater than 0" },
    { "row": 6, "reason": "Duplicate external reference DEMO-BULK-0001 (repeated in this upload)" }
  ]
}
```

- **Code:** routes [`apps/web/src/app/api/payments/callback/route.ts`](../apps/web/src/app/api/payments/callback/route.ts), [`.../bulk/route.ts`](../apps/web/src/app/api/payments/bulk/route.ts); services in [`apps/web/src/modules/payments/services/`](../apps/web/src/modules/payments/services/) (`channel-auth.ts`, `idempotency.ts`, `callbacks.ts`, `ingest.ts`); signature in [`packages/core/src/hmac.ts`](../packages/core/src/hmac.ts).
- **How to test:** `node scripts/send-signed.mjs bulk docs/api/examples/bulk-payments.json my-key-1` (run it twice with the same key to see the replay); `pnpm test` → `hmac.test.ts`; `pnpm test:e2e` → `tests/e2e/specs/payment-api.spec.ts` (bad signature, expired timestamp, missing key, replayed key, conflicting key, duplicate callback).

---

### Q7 · FMIS posting integration

1. **Build the journal** for one business day: every `DONE` payment not yet posted becomes a **credit** line on its revenue type's GL code (configurable `revenue_type.gl_code`); one **debit** line for the day's total goes to the collection bank account (`system_config.collection_bank_gl`, default `1101-000`). One credit line per payment gives full traceability; the payload sent to FMIS is summarised per GL code.
2. **Debits = credits** is checked three times: when the journal is built (`buildDailyJournal` in core), again just before posting (`assertBalanced`), and by a database `CHECK (total_debit = total_credit)`. The mock FMIS also refuses unbalanced journals.
3. **Post** to the mock FMIS REST endpoint `POST /fmis/journals` and store the returned `fmis_reference` on the batch; payments become `fmis_status = POSTED`.
4. **Retries:** exponential backoff (1s, 2s, 4s), **maximum 3 attempts**, then the batch is marked **FAILED**, a critical alert is raised, and a supervisor can retry it from the FMIS screen.
5. **Never posted twice:** `UNIQUE (payment_id)` on `journal_line`; payments are selected `FOR UPDATE SKIP LOCKED` and only if they have no journal line; the request carries a batch reference (`IRCUB-JB-<id>`) so FMIS returns the same reference if our first attempt timed out after FMIS had already saved it.

Batch statuses: **PENDING → POSTED / FAILED**, and **REVERSED** when a posted batch is reversed. Approved reversals of already-posted payments produce a separate REVERSAL journal (debit revenue GL, credit bank), also posted at most once (`UNIQUE (reversal_of_payment_id)`).

**Reconciling IRCUB with FMIS:** every day, compare IRCUB's totals (sum of `DONE` payments per day and GL code, from IRCUB's own data) with FMIS's totals (`GET /fmis/totals` — what FMIS actually booked). Each (day, GL) pair is shown as matched or with the difference; a row can be drilled down to the batch and every payment line. Typical causes of a difference: a FAILED batch not yet retried, a payment that arrived after the day was posted (it goes into a later batch for the same day), or a reversal. The screen is `/fmis/reconciliation`.

- **Code:** [`packages/core/src/journal.ts`](../packages/core/src/journal.ts), [`apps/worker/src/jobs/fmis-posting.ts`](../apps/worker/src/jobs/fmis-posting.ts), comparison logic [`packages/core/src/reconciliation.ts`](../packages/core/src/reconciliation.ts), mock FMIS [`apps/mock-services/src/routes/fmis.ts`](../apps/mock-services/src/routes/fmis.ts).
- **How to test:** `pnpm test` → `journal.test.ts`, `reconciliation.test.ts`; `pnpm test:integration` → `tests/integration/fmis-posting.test.ts` (success, retry then success, FAILED after 3 attempts, no double posting). Live: `curl -X POST localhost:4000/admin/config -H 'content-type: application/json' -d '{"fmisDown":true}'` then retry a batch and watch it fail after 3 attempts.

---

### Q8 · System performance: caching

**Strategy: cache-aside in Redis.** The revenue summary report (per revenue type per day, straight from the live `payment` table) is read through `cacheAside()`:

- **Read:** look in Redis under `summary:{revenue_code}:{date}`; on a miss, run the SQL and store the result with a **5-minute TTL**.
- **Invalidate on write:** when the worker posts a payment (status `DONE`), it deletes exactly the key for that payment's revenue type and day. The next read reloads fresh numbers.
- **TTL as a safety net:** if a delete is ever missed (e.g. Redis unreachable for a moment), stale data still expires within minutes.
- **Redis down ≠ reports down:** cache errors are logged and the report falls back to the database.

**Trade-offs of this choice**

|                                                                                                                      |                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ Simple, and the cache only holds data someone asked for.                                                          | ❌ The first request after an invalidation is slow (cache miss) — acceptable, it is one small query.                                                          |
| ✅ Precise invalidation: one payment invalidates one key, not the whole cache.                                       | ❌ A small race: a reader can load old data just before a payment commits and write it back after the delete; the short TTL bounds how long that lasts.       |
| ✅ Works across several web containers (shared Redis).                                                               | ❌ Cache stampede on a hot key after invalidation — acceptable at this scale; a lock or "stale-while-revalidate" would fix it if needed.                      |
| ✅ The dashboard's heavy history does not need this cache at all: it reads the pre-aggregated `daily_summary` table. | ❌ Write-through (updating the cache on every payment) would avoid misses but couples every payment to Redis and costs more writes during the month-end peak. |

- **Code:** [`packages/platform/src/cache.ts`](../packages/platform/src/cache.ts), [`apps/web/src/modules/dashboard/services/revenue-summary.ts`](../apps/web/src/modules/dashboard/services/revenue-summary.ts), invalidation in [`apps/worker/src/jobs/process-payment.ts`](../apps/worker/src/jobs/process-payment.ts), endpoint `GET /api/reports/revenue-summary?date=YYYY-MM-DD`.
- **How to test:** call the endpoint twice while signed in — the second response shows `"cache": { "hits": N }`; capture a payment and call it again — that revenue type is a miss again. `pnpm test:integration` → `tests/integration/cache.test.ts`.

---

## Frontend

### Q9 · Multi-step payment capture form

**Framework:** React 19 (Next.js App Router) with React Hook Form + Zod. Page: `/payments/capture` (Revenue Officer).

| Step                    | What happens                                                                                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Payer & revenue type | Search by **TIN, phone** (any format: +252…, 061…), **water account number** (WA-000001) or name. The results show open assessments and water bills. Choose the revenue type and, optionally, the assessment or bill (with the amount outstanding).               |
| 2. Payment lines        | One or more lines (up to 10): amount, currency (USD/SOS), channel (bank, mobile money, cash) and external reference. A "Gen" button creates a cash receipt number.                                                                                                |
| 3. Review & submit      | Summary, then submit. The confirmation shows accepted / rejected lines with the **reason per line**, and a **printable receipt** (print CSS hides the navigation). Each line's status changes from PENDING to **DONE live** (Server-Sent Events from the worker). |

- **Validation on both sides with ONE schema:** `captureSchema` (Zod) is used by the form (`zodResolver`) for instant feedback and by the server action (`createAction(..., captureSchema, ...)`) — the server check is the one that counts, because anyone can call a server action directly. The server then runs the same business validation as the bank APIs (duplicate reference, active revenue type, etc.).
- **Tablet-friendly:** large touch targets (40–48 px), numeric keyboard for amounts (`inputMode="decimal"`), one or two columns depending on width, and errors are validated on "Continue" and re-checked while typing (validating on blur made messages disappear mid-tap on a tablet and moved the button — found and fixed by the tablet E2E test).
- **Accessible:** labels tied to inputs, `aria-invalid`, progress list with `aria-current="step"`.

- **Code:** [`apps/web/src/modules/payments/components/capture-form.tsx`](../apps/web/src/modules/payments/components/capture-form.tsx), [`capture-confirmation.tsx`](../apps/web/src/modules/payments/components/capture-confirmation.tsx), schema [`apps/web/src/modules/payments/schemas/payment.ts`](../apps/web/src/modules/payments/schemas/payment.ts), server action [`apps/web/src/modules/payments/actions/capture-actions.ts`](../apps/web/src/modules/payments/actions/capture-actions.ts).
- **How to test:** sign in as `officer@ircub.test` and open _Capture payment_; automated: `pnpm test:e2e` → `tests/e2e/specs/capture.spec.ts` runs on a desktop and a **tablet** (Galaxy Tab S4) profile.
