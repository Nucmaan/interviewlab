# Architecture

## 1. System context and containers

```mermaid
flowchart TB
    subgraph Users
      STAFF["Staff (browser / tablet)<br/>admin, supervisors, officers, auditor"]
      PAYER["Taxpayer / customer<br/>(self-service portal)"]
    end

    subgraph Compose["Docker Compose"]
      direction TB
      WEB["web · Next.js 16<br/>UI (React Server Components)<br/>server actions · REST API · SSE"]
      WORKER["worker · BullMQ<br/>payments · FMIS posting · billing<br/>penalties · summaries · alerts · notifications"]
      PG[("PostgreSQL 17<br/>Prisma schema + /sql functions")]
      REDIS[("Redis 8<br/>queues · cache · pub/sub · rate limit")]
      MIGRATE["migrate (one-shot)<br/>migrations → /sql → seed"]
      MOCK["mock-services · Fastify<br/>bank · mobile money · rates<br/>FMIS · SMS/email"]
    end

    STAFF -- HTTPS --> WEB
    PAYER -- HTTPS --> WEB
    WEB <--> PG
    WEB <--> REDIS
    WORKER <--> PG
    WORKER <--> REDIS
    MIGRATE --> PG
    MOCK -- "signed callbacks<br/>(HMAC)" --> WEB
    WEB -- "initiate payment,<br/>statements, FMIS totals" --> MOCK
    WORKER -- "rates, status checks,<br/>FMIS journals, SMS/email" --> MOCK
```

## 2. Code structure

```mermaid
flowchart LR
    subgraph apps
      W["apps/web<br/>app/ (routes only)<br/>modules/* (components, services,<br/>schemas, actions)<br/>lib/ (auth, rbac, db, redis, logger)"]
      K["apps/worker<br/>jobs/*"]
      M["apps/mock-services<br/>routes/*"]
    end
    subgraph packages
      CORE["packages/core<br/>PURE business rules + unit tests<br/>(no I/O, no framework)"]
      DB["packages/db<br/>Prisma schema, client,<br/>audit writer, seed scripts"]
      PLAT["packages/platform<br/>logger, Redis, queues,<br/>cache, events, rate limit"]
    end
    W --> CORE & DB & PLAT
    K --> CORE & DB & PLAT
    M --> CORE
    DB --> CORE
```

**Rules that keep it explainable**

- **Business logic lives in `packages/core`** as small pure functions (tariff, penalty, validation, HMAC, journals, forecast …). Web and worker both call it, so each rule exists once and is unit tested without a database.
- **Thin entry points:** every API route, server action and page follows _authenticate → authorise → validate (Zod) → call a service → respond_. The permission check is one shared guard (`apps/web/src/lib/rbac.ts`).
- **Money in integer cents** in TypeScript, `NUMERIC(14,2)` in PostgreSQL.
- **The database enforces the invariants** that matter most (unique references, balanced journals, four-eyes, append-only audit), so a bug in application code cannot break them silently.

## 3. Technology choices

| Choice                                  | Why                                                                                                                                                     | Trade-off                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **TypeScript everywhere**               | One language for UI, API, worker, tests; types shared end to end (Zod schemas used by both form and server).                                            | Node is single-threaded — CPU-heavy work goes to the worker.                                               |
| **Next.js 16 App Router**               | Server components read the database directly (fast pages, little client JS); server actions for forms; route handlers for partner APIs; one deployable. | Framework conventions change quickly (e.g. `middleware` → `proxy` in v16).                                 |
| **PostgreSQL 17**                       | Transactions, `SELECT … FOR UPDATE SKIP LOCKED`, window functions, partial / covering / BRIN indexes, partitioning, PL/pgSQL, JSONB.                    | Needs tuning and partitioning at 50M+ rows (designed for in `/sql/02`).                                    |
| **Prisma 7**                            | Typed queries, migrations, readable schema; raw SQL where needed (window functions, locking, the penalty function).                                     | Some features (partitioning, CHECK constraints) must be written in SQL migrations.                         |
| **Redis + BullMQ**                      | Durable queues with retries, backoff and job-id dedupe; the same Redis gives cache, pub/sub for SSE and rate limiting.                                  | One more service to operate; queue state is not the source of truth (the database is).                     |
| **Server-Sent Events**                  | Updates flow one way (server → browser); plain HTTP, auto-reconnect, works through proxies.                                                             | No browser → server messages (not needed).                                                                 |
| **Auth.js credentials + argon2 + TOTP** | Standard session handling and CSRF protection; strong password hashing; optional 2FA.                                                                   | Credentials provider requires JWT sessions, so permissions are re-checked in the database on each request. |
| **Docker Compose**                      | One command brings up the whole system with data.                                                                                                       | Production would use an orchestrator (Kubernetes / ECS) and managed PostgreSQL/Redis.                      |

## 4. Key flows

### 4.1 Payment notification (callback) → processing → live update

```mermaid
sequenceDiagram
    autonumber
    participant CH as Bank / mobile money
    participant API as web: /api/payments/callback
    participant DB as PostgreSQL
    participant Q as Redis (BullMQ)
    participant W as worker
    participant UI as Browser (SSE)
    CH->>API: POST + X-Timestamp, X-Signature, Idempotency-Key
    API->>API: rate limit, verify HMAC (timingSafeEqual), 5-minute window
    API->>DB: claim idempotency key (INSERT … ON CONFLICT DO NOTHING)
    API->>DB: validate (payer, revenue code, unique ref), convert currency
    API->>DB: INSERT payment PENDING / INSERT rejected_payment
    API->>Q: add job payment-{id} (per-category queue)
    API-->>CH: 200 {received, accepted, rejected, errors}
    Q->>W: job
    W->>DB: UPDATE … SET PROCESSING WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)
    W->>DB: BEGIN; lock assessment/bill; apply; SET DONE WHERE PROCESSING; audit; COMMIT
    W->>Q: invalidate summary:{code}:{date}; schedule daily_summary refresh
    W-->>UI: publish payment.updated → SSE
```

### 4.2 Nightly FMIS posting with retries

```mermaid
sequenceDiagram
    autonumber
    participant S as Scheduler (01:00)
    participant W as worker: fmis-posting
    participant DB as PostgreSQL
    participant F as FMIS
    S->>W: post-pending
    loop each unposted business day
      W->>DB: SELECT DONE payments without journal line FOR UPDATE SKIP LOCKED
      W->>W: buildDailyJournal (credit revenue GLs, debit bank), assert debits = credits
      W->>DB: INSERT journal_batch PENDING + lines (UNIQUE payment_id)
      loop up to 3 attempts, backoff 1s, 2s, 4s
        W->>F: POST /fmis/journals {batchRef, lines per GL}
      end
      alt posted
        F-->>W: fmisReference
        W->>DB: batch POSTED, payments fmis_status POSTED, audit
      else still failing
        W->>DB: batch FAILED, alert FMIS_POSTING_FAILED (manual retry later)
      end
    end
```

### 4.3 Monthly water billing cycle

```mermaid
flowchart TD
    A[Water officer: Run cycle for month M] --> B[billing_cycle RUNNING → queue job]
    B --> C{for each active account}
    C --> D{actual reading in M?}
    D -- yes --> E[consumption from reading]
    D -- no --> F{actual history?}
    F -- yes --> G[estimate = avg of last 3 actual<br/>create ESTIMATED reading<br/>exception: ESTIMATED]
    F -- no --> H[exception: NO_READING<br/>no bill]
    E --> I{"> 200% of 3-month avg?"}
    G --> J
    I -- yes --> K[bill status HELD<br/>exception: ABNORMAL]
    I -- no --> J[calculateWaterBill with tariff bands from DB]
    K --> J2[compose: previous total − payments + charges]
    J --> J2
    J2 --> L[insert bill + WB control number<br/>previous bill → CARRIED_FORWARD]
    L --> M{held?}
    M -- no --> N[queue SMS + email]
    M -- yes --> O[wait for officer to Release]
    C --> P[cycle COMPLETED + exception report → SSE]
```

### 4.4 Reversal with segregation of duties

```mermaid
sequenceDiagram
    participant O as Officer / supervisor A
    participant S as Supervisor B
    participant DB as PostgreSQL
    O->>DB: reversal PENDING_APPROVAL (requested_by = A), audit
    O--xDB: A tries to approve → blocked (code + CHECK decided_by <> requested_by)
    S->>DB: approve: lock payment, status REVERSED, amount taken off assessment/bill, audit
    Note over DB: If the payment was already posted to FMIS,<br/>the next FMIS run posts a REVERSAL journal (UNIQUE reversal_of_payment_id)
```

## 5. No double processing — the guarantees in one place

| Layer          | Guarantee                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | `Idempotency-Key` claimed first; replay returns the stored response.                                                                                          |
| Database       | `UNIQUE (external_ref)` — a channel payment can be stored once.                                                                                               |
| Queue          | Job id `payment-{id}` — duplicate jobs are ignored while the first exists.                                                                                    |
| Worker         | Claim with `FOR UPDATE SKIP LOCKED` only `WHERE status = 'PENDING'`; apply + `DONE` in one transaction `WHERE status = 'PROCESSING'`.                         |
| Crash recovery | Rows stuck in `PROCESSING` > 5 min go back to `PENDING` (safe: DONE was never committed); old `PENDING` rows are re-queued.                                   |
| FMIS           | Only payments without a journal line are selected (`FOR UPDATE SKIP LOCKED`); `UNIQUE (payment_id)` on `journal_line`; FMIS dedupes on `IRCUB-JB-{batch_id}`. |

## 6. Scaling to 50 million payments

- Web is stateless → run several containers behind a load balancer (sessions are JWT; SSE fans out through Redis pub/sub).
- Workers scale horizontally; per-category queues isolate tax from water peaks; concurrency is an environment variable.
- Reporting never scans `payment`: covering partial index + BRIN for range queries, `daily_summary` for dashboards, Redis cache for live day summaries.
- Monthly partitioning of `payment` (DDL in `sql/02-indexes-and-partitioning.sql`) when the table grows past what indexes handle comfortably; old partitions archived.
- PostgreSQL: connection pooling (PgBouncer), read replica for reports, managed backups with point-in-time recovery.
