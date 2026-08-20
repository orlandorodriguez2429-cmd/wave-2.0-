# Wave 2.0

Small-business accounting with correct double-entry bookkeeping underneath, and a first-class 1099 contractor workflow on top. See [PROJECT.md](./PROJECT.md) for the full product brief and phase plan.

**Current status: Phase 1 — Ledger core** (chart of accounts, double-entry engine, manual journal entries, trial balance / P&L / balance sheet).

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- PostgreSQL via Prisma 7 (`@prisma/adapter-pg` driver adapter)
- Vitest (unit + DB integration tests)

## Getting started

Requirements: Node 20+, PostgreSQL 14+.

```bash
# 1. Install dependencies
npm install

# 2. Create a database and role (adjust to taste)
sudo -u postgres psql \
  -c "CREATE ROLE wave WITH LOGIN PASSWORD 'wave_dev_password' CREATEDB;" \
  -c "CREATE DATABASE wave OWNER wave;"

# 3. Point the app at it
cp .env.example .env   # edit DATABASE_URL if yours differs

# 4. Apply migrations and seed demo data
npx prisma migrate dev
npx prisma db seed

# 5. Run
npm run dev            # http://localhost:3000
```

The seed creates a demo business ("Acme Consulting LLC") with the standard chart of accounts and a few posted entries so the dashboard and reports have data. Until interactive auth ships (later phase), every request acts as the seeded demo owner — see `src/lib/context.ts`, the single swap point.

## Tests

```bash
npx vitest run
```

Unit tests cover money parsing/formatting/FX conversion and entry validation. Integration tests run against `DATABASE_URL` and prove the invariants hold **at the database level**: posted entries and their lines reject `UPDATE`/`DELETE` (even via raw SQL), unbalanced entries cannot reach `POSTED`, amounts must be positive, reversals link and cancel exactly, and the balance sheet balances.

## Ledger design (the part to understand before touching anything)

- **Double entry, always.** A `JournalEntry` owns ≥ 2 `JournalLine`s; each line is a positive integer amount (minor units) plus a `DEBIT`/`CREDIT` direction. Debits must equal credits — validated in the service layer (`src/lib/ledger/validate.ts`) and enforced again by a Postgres trigger at the `DRAFT → POSTED` transition.
- **Immutable once posted.** Postgres triggers (`prisma/migrations/*_ledger_integrity`) block any `UPDATE`/`DELETE` of a posted entry or its lines, and block inserting entries directly in `POSTED` state. Corrections are reversing entries linked via `reversesId`; the original row is never touched.
- **Money is integers.** Minor units (`BigInt`) everywhere; decimal parsing/formatting never passes through floats (`src/lib/money.ts`).
- **Multi-currency.** Entries carry a transaction currency + exchange rate; every line stores both the transaction amount and the functional-currency amount, balanced in both. FX rounding residue is allocated to the largest line so the functional view balances exactly.
- **Audit trail.** Every ledger-affecting action writes an `AuditLog` row (who/when/what), visible at `/audit`.
- **Reports are derived, never stored.** Trial balance, P&L, and balance sheet aggregate posted lines in SQL (`src/lib/ledger/reports.ts`); the balance sheet folds net income into equity as Current Year Earnings, so Assets = Liabilities + Equity holds by construction.
