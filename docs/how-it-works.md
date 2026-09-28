# How IRCUB works — a plain-English guide

This guide walks through every flow in the POC, in the order a user meets them, and says **which file does what**. Read it with the code open. Diagrams are in [`architecture.md`](architecture.md); the database in [`erd.md`](erd.md).

---

## 0. The big picture in one paragraph

There are three programs. **web** (`apps/web`) is the website and the REST API. **worker** (`apps/worker`) does the slow or scheduled work in the background: applying payments, posting to FMIS, running the billing cycle, penalties, reports and alerts. **mock-services** (`apps/mock-services`) pretends to be the bank, the mobile money provider, the exchange-rate service, FMIS and the SMS/email gateway. They share PostgreSQL (the truth) and Redis (queues, cache, live events). All business rules — how a bill is calculated, how a penalty works, what makes a payment valid — are small pure functions in **`packages/core`**, with unit tests.

## 1. Starting the system

`docker compose up --build` (`docker-compose.yml`) starts, in order:

1. **postgres** and **redis** (with health checks).
2. **migrate** (`packages/db/Dockerfile`), a one-shot container that runs:
   - `prisma migrate deploy` — creates the tables from `packages/db/prisma/migrations/` (the first migration is generated from `schema.prisma`; the second adds CHECK constraints, sequences and the append-only audit trigger; the third adds reversal journal lines);
   - `scripts/apply-sql.ts` — runs every file in `/sql` (the Part 1 SQL answers as functions, plus indexes);
   - `scripts/seed.ts` — if the database is empty, creates roles, permissions, demo users, revenue types, tariffs, config, and two years of fictional history (`scripts/seed/history.ts`). It reuses `packages/core` so seeded bills follow the same rules as real ones.
3. **mock-services**, then **web** and **worker** (they wait until migrate has finished successfully).

On start the worker registers its schedules (`apps/worker/src/index.ts`): exchange rates every 15 min, maintenance every minute, penalties at 02:00, FMIS posting at 01:00 (plus once at startup to post the seeded history), summary refresh at 00:30.

## 2. Signing in and permissions

- **Login page:** `apps/web/src/app/(auth)/login/page.tsx` → form `modules/users/components/login-form.tsx` → server action `modules/users/actions/session-actions.ts` → Auth.js (`lib/auth/index.ts`) → `verifyLogin()` in `modules/users/services/auth-service.ts`.
- `verifyLogin` finds the user, refuses inactive or locked accounts, checks the argon2 hash (`passwords.ts`), then the TOTP code if 2FA is on (`totp.ts`). Five wrong passwords lock the account for 15 minutes. Every attempt is audited.
- The session cookie holds only the user id. On **every request**, `getCurrentUser()` in `lib/rbac.ts` loads the user, checks `is_active`, and works out their permissions from their roles _and the roles' parents_ (`resolvePermissions()` in `packages/core/src/access-control.ts`).
- **Pages** call `requirePermission('payments.view')`; **server actions** are built with `createAction(permission, zodSchema, handler)` (`lib/action.ts`); **API routes** use `withPermission(...)`. Missing permission → the _no access_ page, or HTTP 401/403 for APIs.
- The **menu** (`lib/navigation.ts`, filtered in `app/(app)/layout.tsx`) only shows links the user may open — but the pages check again, because hiding a link is not security.
- `src/proxy.ts` (Next.js 16's name for middleware) only redirects visitors without a session to `/login`.

## 3. Registering a payer

`/payers/new` → `createPayerAction` → `createPayer()` in `modules/registry/services/payers.ts`:

1. Refuse if the TIN already exists (also `UNIQUE (tin)` in the database).
2. Save the payer.
3. Look for possible duplicates: a broad query finds candidates with a similar phone, email or national ID, then `findDuplicateMatches()` (`packages/core/src/duplicates.ts`) compares normalised values (`+252 61…`, `0061…`, `061…` are the same phone). Matches go into `duplicate_flag` — the registration is **not** blocked.
4. Write the audit record in the same transaction.

The payer page `/payers/[id]` (`getPayerProfile()`) is the 360° view: balances, assessments, water accounts with the latest bill, recent payments, duplicate warnings.

## 4. Assessments and control numbers

`/revenue/assessments` → `createAssessment()` in `modules/revenue/services/assessments.ts`:

- checks the TIN exists and the revenue type is an active TAX type;
- takes the next number from the PostgreSQL sequence `assessment_control_seq` and formats it with `generateControlNumber('AS', year, seq)` → `AS-2026-0001234-6`, where the last digit is a **Luhn check digit** (`packages/core/src/control-number.ts`). A mistyped number is rejected before it reaches a payment.

**CSV upload** (`/revenue/upload`): the browser parses the file with papaparse and checks every row with the same Zod schemas the server uses (`modules/revenue/schemas/revenue.ts`), showing problems before upload. The server (`csv-upload.ts`) re-validates everything, saves valid rows and returns the report (total, accepted, rejected + reason per row). Payment CSVs go through the same pipeline as the bank API (next section).

## 5. Payments coming in (the heart of the system)

There are four ways in, all ending in **`ingestPayments()`** (`modules/payments/services/ingest.ts`):

| Way in                                                                | Entry point                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Bank / aggregator bulk file (JSON)                                    | `POST /api/payments/bulk` (`app/api/payments/bulk/route.ts`)                                    |
| Payer paid with a control number at a bank or in the mobile money app | `POST /api/payments/callback` → `handleCallback()` (`callbacks.ts`) looks up the control number |
| Officer at the counter                                                | the capture form (`modules/payments/components/capture-form.tsx`) → `capturePaymentsAction`     |
| CSV upload                                                            | `/revenue/upload`                                                                               |

**Security for the two API routes** (`channel-auth.ts`): rate limit per IP (Redis) → HMAC signature check over `timestamp + "." + rawBody` with `timingSafeEqual` (`packages/core/src/hmac.ts`) → timestamp must be within 5 minutes → `Idempotency-Key` header required. Then `withIdempotency()` (`idempotency.ts`) claims the key in the `idempotency_key` table _before_ doing anything; if the same key comes back, the stored response is returned (header `Idempotent-Replayed: true`).

**What `ingestPayments()` does:**

1. **Shape check per row** with Zod (`paymentRecordSchema`) — a bad row never fails the whole file.
2. **Business rules** with `validatePaymentRecords()` (`packages/core/src/payment-validation.ts`): amount > 0 with ≤ 2 decimals, payer exists, revenue code exists and is active, `external_ref` not already received and not repeated in the same file, not in the future, the assessment/bill belongs to the payer. The reference data is loaded with 5 queries in total.
3. **Currency:** the latest stored rate (`rates.ts`) converts USD to SOS: `amount_base`.
4. **Save, in one transaction:** valid rows into `payment` with status `PENDING` (`createManyAndReturn … skipDuplicates` = `ON CONFLICT DO NOTHING`, so if another request stored the same `external_ref` a millisecond earlier, the row is reported as a duplicate instead of crashing); rejected rows into `rejected_payment` with the reason.
5. **Queue** each payment on `payments-tax` or `payments-water` (`packages/platform/src/queues.ts`) with job id `payment-{id}`.
6. Return `{ received, accepted, rejected, errors: [{ row, reason }] }`.

If Redis is down at step 5, nothing is lost: the payment is safely `PENDING` and the worker's maintenance job re-queues it within 2 minutes.

## 6. The worker applies payments — exactly once

`apps/worker/src/jobs/process-payment.ts`, `processPayment()`:

1. **Claim:** `UPDATE payment SET status='PROCESSING' WHERE payment_id = (SELECT … WHERE status='PENDING' FOR UPDATE SKIP LOCKED)`. If two workers try the same payment at the same moment, one gets the row and the other gets nothing and skips (`SKIP LOCKED` means "don't wait, move on").
2. **Apply, in one transaction:** lock the assessment or bill row, add the amount with `applyPayment()` (`packages/core/src/settlement.ts`, in cents), update its status (PART_PAID / PAID), set the payment `DONE` **only if it is still PROCESSING**, and write the audit record. Either all of it is saved or none.
3. **After commit:** delete the Redis cache key `summary:{revenue_code}:{date}`, schedule a `daily_summary` refresh (debounced), publish `payment.updated` for live screens.
4. If something throws, the claim is released (back to `PENDING`) and BullMQ retries with exponential backoff; after the last attempt the payment is marked `FAILED` with the reason.

`maintenance.ts` resets payments stuck in `PROCESSING` for 5 minutes (a crashed worker) — safe, because `DONE` is only ever written together with the money.

**Why this is enough to never process twice:** unique `external_ref` (can't store twice) + `SKIP LOCKED` (can't claim twice at once) + status conditions (can't claim a finished payment, can't finish an unclaimed one). The integration test `tests/integration/payment-processing.test.ts` races 4 processors per payment and checks the money is applied exactly once.

## 7. Live updates (SSE)

The worker publishes events on the Redis channel `ircub:events` (`packages/platform/src/events.ts`). Each open browser has an `EventSource` on `/api/events` (`app/api/events/route.ts`), which subscribes to that channel and forwards events (self-service users only get their own payments). Components use `useLiveEvents()` (`components/use-live-events.ts`); `RefreshOnEvent` re-renders a server page when an event arrives. That is how the receipt turns from PENDING to DONE and the dashboard numbers move without a reload.

## 8. Reversals and segregation of duties

On a payment's page (`/payments/[id]`) someone with `reversals.request` asks for a reversal with a reason (`requestReversal()` in `modules/payments/services/reversals.ts`). On `/payments/reversals` a **different** person with `reversals.approve` decides. `assertCanApprove()` blocks the requester, and the database has `CHECK (decided_by <> requested_by)` so it holds even if the code were bypassed. Approving sets the payment `REVERSED`, takes the amount back off the assessment or bill, and audits everything. If the payment had already been posted to FMIS, the next FMIS run posts a reversal journal.

## 9. Penalties

Rule (`packages/core/src/penalty.ts`): months 1–3 at 5%, month 4 onward at 10% of the unpaid principal, full months only, capped at 100% of the amount due, never lower than a penalty already charged. The worker runs it daily (`jobs/penalties.ts`), and the same rule exists as a PostgreSQL function (`sql/05-penalty-procedure.sql`). Idempotent because the **total** is recalculated and SET, and `penalty_history` has `UNIQUE (assessment_id, run_date)` with `ON CONFLICT DO NOTHING`. `tests/integration/penalty.test.ts` proves both versions agree and a second run changes nothing.

## 10. Water: readings, billing cycle, statements

- **Readings** (`/water/readings`, `modules/water/services/readings.ts`): consumption = `calculateConsumption(previous, current, { meterDigits, flag })` (`packages/core/src/tariff.ts`). A lower reading throws unless flagged `ROLLOVER` (`(10^digits − previous) + current`) or `METER_REPLACEMENT` (new meter starts at 0). CSV upload validates each row the same way.
- **Billing cycle** (`/water/billing` → worker `jobs/billing.ts`): for each active account — reading or estimate (average of last 3 actual), abnormal check (> 200% of the 3-month average → `HELD`), charges from the tariff bands loaded from `tariff`/`tariff_band` (`calculateWaterBill`), arrears carried forward (`composeBill`: previous total − payments + charges), a `WB-…` control number, the previous bill marked `CARRIED_FORWARD`, and an SMS/email via the notification outbox. Exceptions (estimated, abnormal, no reading, zero use, errors) are stored on the cycle as the exception report. Re-running never bills an account twice (`UNIQUE (account_no, billing_month)`).
- **Release** a held bill (`releaseBill()`) → status `ISSUED` + notification.
- **Statement** (`/water/accounts/[no]`) — `buildStatement()` lists bills (debit) and payments (credit) with a running balance.
- **PDF bill with QR code** — `GET /api/water/bills/{id}/pdf` (`bill-pdf.ts`, pdfkit + qrcode).

## 11. Channel payments from the portal (mobile money) and retries

The taxpayer (`taxpayer@ircub.test`) opens `/portal` and clicks _Pay with mobile money_ (`pay-button.tsx`) → `initiateMobilePayment()` (`modules/payments/services/portal.ts`):

1. saves the payment as `AWAITING_CONFIRMATION` (so nothing is lost if anything fails later);
2. asks the mock provider to push the payment to the phone (`POST /payments` on mock-services);
3. queues a **status check** in 15 s with 3 attempts and exponential backoff.

The provider completes the payment after 1–4 s and sends a signed callback. `handleCallback()` finds the `AWAITING_CONFIRMATION` payment, checks the amount matches, moves it to `PENDING` and queues it → the worker makes it `DONE` → the portal shows "Paid". If the callback is lost (the mock drops 20% on purpose), the status check (`jobs/payment-status.ts`) asks the provider and confirms it; if after 3 checks there is still no answer, the payment becomes `FAILED`, an alert is raised and supervisors are emailed.

**Channel reconciliation** (`/payments/reconciliation`): downloads the day's statement CSV from the provider (or accepts an upload) and compares it with IRCUB's DONE payments for that channel and day (`reconcileChannelStatement()` in `packages/core/src/reconciliation.ts`): matched, amount mismatch, missing in IRCUB, missing in statement. The mock deliberately changes one amount and adds one unknown line so the report has something to show.

## 12. FMIS posting and reconciliation

`apps/worker/src/jobs/fmis-posting.ts`:

- `postBusinessDay(date)`: selects the day's DONE, not-yet-posted payments `FOR UPDATE SKIP LOCKED`, builds the journal with `buildDailyJournal()` (one credit line per payment to its revenue GL, one debit line to the bank GL), checks it balances, saves the batch and lines (`UNIQUE (payment_id)`), then `sendBatch()` posts a per-GL summary to FMIS with batch reference `IRCUB-JB-{id}`.
- `sendBatch()` tries up to 3 times with 1s/2s/4s backoff; success → `POSTED` + FMIS reference, payments `POSTED`; failure → `FAILED` + critical alert. Supervisors can _Retry_ or _Reverse_ from `/fmis`.
- `/fmis/reconciliation` (`modules/fmis/services/fmis.ts`) compares what IRCUB says should be in FMIS per day and GL code with what FMIS reports (`GET /fmis/totals`), with drill-down to every payment and its batch.

## 13. Dashboard, forecast and alerts

`/dashboard` reads only pre-aggregated data (`modules/dashboard/services/reports.ts`): monthly trends by revenue type and channel from `daily_summary`, collections vs `revenue_target`, water billed vs collected from `collection_efficiency()` (`sql/03`), the financial-year quarter table from `quarterly_collections()` (`sql/01`), top arrears from `top_water_arrears()` (`sql/04`). "Collected today" uses the Redis-cached revenue summary (`revenue-summary.ts`).

**Forecast** (`packages/core/src/regression.ts`): plain least-squares linear regression over 24 complete months (as the brief asks), and a better model — the same trend multiplied by each calendar month's seasonal factor — because business licences all fall in January, which a straight line cannot capture. Both are shown with R² and their limits.

**Alerts** (`jobs/summaries.ts`): after each summary refresh, reversal spikes are checked for today; the nightly job checks yesterday for a collection drop against the 7-day average. Thresholds come from `system_config.alert_rules`. Alerts are pushed live and listed on `/alerts`.

**Demo button:** _Demo: simulate 20 mobile money payments_ (supervisor) asks the mock provider to pay 20 random open items, which arrive as real signed callbacks — watch the dashboard update.

## 14. The audit log

`recordAudit()` (`packages/db/src/audit.ts`) is called inside the same transaction as each change. It takes an advisory lock (so concurrent writers take turns), reads the last hash, computes `SHA-256(prev_hash + canonical JSON of the row)` (`packages/core/src/audit-hash.ts`) and inserts. A trigger forbids UPDATE/DELETE/TRUNCATE. `/audit` → _Verify chain_ recomputes all hashes and names the first broken row. Try `pnpm --filter @ircub/db tamper-demo` then verify; `-- --undo` restores it.

## 15. Where the Part 1 answers live

| Question                           | Code                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| Quarterly SQL + indexes            | `sql/01`, `sql/02`                                                            |
| Collection efficiency, top arrears | `sql/03`, `sql/04`                                                            |
| Penalty routine                    | `sql/05`, `packages/core/src/penalty.ts`, `apps/worker/src/jobs/penalties.ts` |
| Water bill function                | `packages/core/src/tariff.ts` (+ tests)                                       |
| Validation & concurrency           | `payment-validation.ts`, `ingest.ts`, `process-payment.ts`                    |
| Payment Notification API           | `app/api/payments/*`, `modules/payments/services/*`, `docs/api/openapi.yaml`  |
| FMIS posting                       | `packages/core/src/journal.ts`, `apps/worker/src/jobs/fmis-posting.ts`        |
| Caching                            | `packages/platform/src/cache.ts`, `revenue-summary.ts`                        |
| Capture form                       | `modules/payments/components/capture-form.tsx`                                |

## 16. A 10-minute demo script for the POC

1. Sign in as **officer** → _Capture payment_ → search `WA-000001` → Stamp Duty → one USD line, one SOS line → submit → watch both turn DONE → print receipt.
2. Run `node scripts/send-signed.mjs bulk docs/api/examples/bulk-payments.json demo-1` twice → per-row reasons, then `Idempotent-Replayed`.
3. Sign in as **supervisor** → a payment → request reversal → _Reversals_ shows "another supervisor must decide" → sign in as **supervisor2** → approve.
4. **water** → _Billing cycles_ → run → open the cycle → exception report, release a held bill → PDF with QR.
5. **taxpayer** → _My account_ → pay with mobile money → "confirm on your phone" → "Paid".
6. **supervisor** → _FMIS_ → batches; `curl -X POST localhost:4000/admin/config -H 'content-type: application/json' -d '{"fmisDown":true}'` → _Post pending days now_ / _Retry_ → FAILED after 3 attempts + alert → set `fmisDown:false` → Retry → POSTED → _FMIS reconciliation_.
7. **supervisor** → _Dashboard_ → _Demo: simulate 20 payments_ → numbers update live; explain the forecast.
8. **auditor** → _Audit log_ → _Verify chain_; run the tamper demo and verify again.
