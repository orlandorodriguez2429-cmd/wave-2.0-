# Wave 2.0

Small-business accounting with correct double-entry bookkeeping underneath, and a first-class 1099 contractor workflow on top. See [PROJECT.md](./PROJECT.md) for the full product brief and phase plan.

**Status: Phases 1–6 built** — ledger core · invoicing & expenses · bank feeds & reconciliation · W-9/1099 tracking · 1099 generation & e-file · reports, auth, multi-entity, roles, close-the-books, API.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS 4
- PostgreSQL via Prisma 7 (`@prisma/adapter-pg` driver adapter)
- pdfkit (invoice + 1099 PDFs), Vitest (unit + DB integration tests)

## Getting started

Requirements: Node 20+, PostgreSQL 14+.

```bash
npm install

# database + role (adjust to taste)
sudo -u postgres psql \
  -c "CREATE ROLE wave WITH LOGIN PASSWORD 'wave_dev_password' CREATEDB;" \
  -c "CREATE DATABASE wave OWNER wave;"

cp .env.example .env   # set DATABASE_URL and a real ENCRYPTION_KEY (32 bytes base64)

npx prisma migrate deploy   # apply all migrations
npx prisma db seed          # demo business + sample data
npm run dev                 # http://localhost:3000
```

**Demo login:** `demo@wave2.local` / `demo-password-123`

Background jobs (recurring invoices): `npx tsx scripts/run-jobs.ts` on a cron.
Tests: `npx vitest run` (81 tests; integration tests hit `DATABASE_URL`).

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (this is a ledger — Postgres only). |
| `ENCRYPTION_KEY` | 32 bytes base64; AES-256-GCM for TINs, EINs, bank tokens. Sessions are HMAC-signed with a derived key. |
| `EFILE_TRANSMITTER` | `mock` (sandbox provider, default) or `iris` (needs `IRIS_TCC` + credentials). |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Activates the real Plaid adapter (sandbox bank feed works without). |
| `EMAIL_PROVIDER` | `console` (sandbox, default — logs and records the email, no network call) or `smtp` (needs `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`). |

## Architecture notes

- **Double entry, always.** Balanced debit/credit journal entries against the chart of accounts; enforced in the service layer *and* by Postgres triggers (posting gate, immutability of posted entries and lines, positive-amount CHECKs). Corrections are linked reversing entries — nothing is ever edited in place.
- **Money is integers** (BigInt minor units) end to end; quantities in thousandths; tax rates in parts-per-million; FX via just-in-time integer arithmetic with rounding-residue allocation.
- **Every business document posts through the same engine**: invoice approval, payments, voids, expenses, bills, bill payments, late fees, bank-feed categorizations. Bills are enter-now-pay-later (Dr Expense / Cr Accounts Payable on approval, Dr A/P / Cr cash on payment) — distinct from Expenses, which record money already paid. Late fees are opt-in per business (a configurable percentage, not a code constant), one-time per invoice, and post to a dedicated Late Fee Income account. Reports (trial balance, P&L, balance sheet, cash flow, sales tax, aged receivables, aged payables) are derived at query time and export to CSV.
- **Cash vs. accrual, for real.** The ledger itself is accrual (revenue/expense recognized at invoice/bill approval). The P&L report has an Accrual/Cash toggle — cash basis re-derives recognition from actual payment dates (allocating each customer/bill payment back across the original document's lines) instead of re-filtering posted entries, so it's not just a label.
- **Checkouts** are standalone payment links (not tied to an invoice) — post Dr deposit account / Cr a chosen income account through the same engine, same sandbox-pay convention as invoice portal payments. **Products & Services** is a shared price-list catalog (name, price, income account) for Sales & Payments and Purchases — not yet wired into the invoice/bill line-item pickers. **Recurring Invoices** has a management UI on top of the existing scheduler (create/pause/resume/delete). **Customer Statements** is a per-customer running-balance report.
- **Payroll is deliberately partial.** Employees and Timesheets are real (a directory and hours log, no wage math). Payroll runs, tax withholding, and tax forms are honest "not built" pages — they need a licensed payroll-tax provider this project doesn't have, the same category of gap as receipt OCR.
- **1099 pipeline** (the differentiator): W-9 collection via single-use public links with e-consent capture → per-year, per-box payment accumulation with the card/1099-K exclusion → per-tax-year configurable thresholds ($600 → $2,000 for TY2026+, editable, verify against IRS.gov) → versioned immutable forms with linked corrections → pluggable transmitter (sandbox provider now, direct IRIS A2A stub behind a TCC) → Copy B delivery with consent rules. E-file submission only ever happens behind an explicit human confirmation click.
- **Secrets**: TINs/EINs/bank tokens stored AES-256-GCM encrypted, displayed masked, never logged or put in audit payloads. API tokens stored as SHA-256 hashes.
- **Auth & tenancy**: signed cookie sessions, multi-business per login with a switcher, roles (owner / accountant / employee / view-only) enforced in every mutating action, append-only audit log, period close locks the ledger.
- **Developer API**: `GET /api/v1/{accounts,invoices,reports/trial-balance}`, `GET|POST /api/v1/webhooks` with `Authorization: Bearer wave_…`; webhook deliveries HMAC-signed (`X-Wave-Signature`).

## What is sandboxed vs production-ready

Real external integrations are behind adapters with working sandbox implementations: bank feeds (mock provider ↔ Plaid), invoice payments and Checkouts (sandbox pay button ↔ Stripe Checkout/Connect), e-file (mock transmitter ↔ provider API / IRIS A2A), file storage (local disk ↔ S3), invoice reminders (console/log provider ↔ SMTP). Receipt OCR and full W-2 payroll (tax withholding, filings, direct deposit) are noted future work — both need a third-party integration and a data-model decision this project hasn't made yet. Business insurance quotes and payroll-tax filing specifically need a licensed partner, not just an API key.
