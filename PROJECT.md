# Project brief — "Wave 2.0" Accounting Platform

Build a full-stack small-business accounting web app that matches and exceeds Wave Accounting's feature set. Priorities: correct double-entry bookkeeping under the hood, a fast/clean UI, and a genuinely working 1099 contractor workflow (collect W-9 → track payments → generate forms → e-file with the IRS) — this last part is Wave's weakest area and the main reason this app needs to exist.

Work incrementally. After each phase below, stop, show what was built and how to run it, and wait for confirmation before moving to the next phase. Don't guess silently on data-model or compliance decisions.

## Tech stack

- Frontend: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- Backend: Next.js API routes / server actions, or a separate Node/Express service if the domain logic gets heavy
- Database: PostgreSQL (this is a ledger — real transactions/constraints, not a document store) via Prisma or Drizzle
- Auth: email/password + OAuth (multi-user orgs with roles: owner, accountant, employee, contractor-view-only)
- File storage: S3-compatible bucket for receipts, W-9s, generated PDFs
- PDF generation: for invoices, 1099s, financial statements
- Background jobs: recurring invoices, bank sync polling, month-end close reminders, e-file batch submission
- Payments: Stripe Connect (invoice payments + eventually contractor payouts)
- Bank feeds: Plaid for transaction import/reconciliation

## Core accounting engine (build first)

- Real double-entry bookkeeping: every transaction is a set of balanced debit/credit entries against a Chart of Accounts.
- Standard chart of accounts template on signup (Assets, Liabilities, Equity, Income, Expenses, COGS), editable/extensible per business.
- Immutable ledger: transactions post once; corrections happen via reversing/adjusting entries, never silent edits.
- Multi-currency support (store amounts in minor units/cents, never floats).
- Fiscal year config, accounting basis (cash vs. accrual) — support real accrual.

## Feature parity with Wave (table stakes)

- Invoicing: recurring invoices, partial payments, late fees, custom templates, client portal, automatic reminders.
- Estimates/quotes convertible to invoices.
- Expense tracking: manual entry + receipt photo upload with OCR line-item extraction, categorization, mileage tracking.
- Bank & credit card connections: Plaid-based import, auto-categorization (rules + ML suggestions), reconciliation workflow.
- Reports: P&L, Balance Sheet, Cash Flow, Trial Balance, Sales Tax, Aged Receivables/Payables — exportable (PDF/CSV), date-range filterable.
- Multiple businesses per login, multiple bank accounts per business.
- Payroll-lite: contractor and vendor payments feeding 1099 reporting. Full W-2 payroll is a stretch goal (phase 2+).
- Sales tax tracking by jurisdiction on invoices/expenses.

## The 1099 module (the differentiator — build carefully)

Ground rules from current IRS requirements (verify against IRS.gov before shipping, rules shift year to year):

- W-9 collection: secure request-and-upload flow (or structured entry: name, TIN, entity type, address) before a vendor can be marked 1099-eligible. Store TIN encrypted at rest.
- Payment tracking: every vendor payment accumulates against calendar-year totals, split by box type (NEC, MISC rent/royalties/other, INT, DIV). Exclude credit-card/third-party-network payments (1099-K territory, reported by the processor) — a common compliance bug to get right.
- Threshold logic configurable, not hardcoded: the federal 1099-NEC/MISC minimum reporting threshold changed from $600 to $2,000 for tax years beginning after 2025 (inflation adjustments from 2027). Store thresholds as per-tax-year lookup values. Flag vendors approaching/crossing thresholds.
- Form generation: 1099-NEC and 1099-MISC (stub INT/DIV) as filled PDFs (Copy A, B, C), with a review/edit step — never auto-file without user confirmation.
- E-filing: IRS retired FIRE; IRIS is the primary e-file portal, required for TY2026+ filings. Pluggable transmitter layer supporting (1) direct IRIS A2A (needs a TCC, ~45 business days) and (2) third-party e-file provider API (Track1099/Tax1099-style) — start with (2), add (1) as phase-2 power-user option.
- E-file threshold: e-filing mandatory once combined information returns hit 10/year — track the aggregate and warn.
- Recipient copies: Copy B electronically (with IRS-required e-consent capture) or mailed PDF, by Jan 31.
- State filing: support CF/SF where the state participates; flag states requiring separate direct filing.
- Corrections workflow: corrected 1099s linked to the previously filed form, not new independent forms.
- Audit trail: every generated/filed 1099 versioned and immutable once submitted; corrections create new versions.

## Where else to beat Wave

- Real bank reconciliation UI — proper "match transaction to statement line" workflow with running variance.
- Better multi-entity support (several LLCs/DBAs from one login).
- Role-based permissions that actually work.
- Accountant-facing "close the books" checklist per period.
- API + webhooks for developers.
- No degraded free-tier upsell dark patterns — pricing decided separately, must not distort the data model.

## Non-negotiables / guardrails

- Never store raw TINs/SSNs/bank credentials in plaintext or logs. Encrypt at rest, redact in error reporting.
- Every money field is an integer (cents), never a float.
- Every ledger-affecting action is logged with who/when.
- IRS e-file submission must never fire without an explicit human "Submit to IRS" confirmation click.
- IRS threshold/deadline numbers are configuration, not code constants; flag any IRS data not verified as current.

## Build order

1. **Phase 1 — Ledger core**: chart of accounts, double-entry engine, manual journal entries, basic P&L/Balance Sheet. ✅ (current)
2. **Phase 2 — Invoicing & expenses**: invoices, estimates, expense entry, receipt upload.
3. **Phase 3 — Bank integration**: Plaid connection, transaction import, categorization, reconciliation.
4. **Phase 4 — Vendors & 1099 tracking**: vendor records, W-9 collection, payment accumulation, threshold monitoring.
5. **Phase 5 — 1099 generation & e-file**: PDF generation, third-party e-file provider integration, recipient delivery, corrections.
6. **Phase 6 — Reports, multi-entity, roles, polish.**
