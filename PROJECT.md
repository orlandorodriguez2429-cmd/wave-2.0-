# Claude Code Prompt — "Wave 2.0" Accounting Platform

> **Implementation status: Phases 1–6 are built.** See [README.md](./README.md) for
> what runs today, how to start it, and what's sandboxed vs. production-ready.
> This document is kept verbatim as the original project brief / source-of-truth
> prompt — the one to hand to a fresh Claude Code session if this project is
> ever restarted or forked. Don't re-run phases 1–6 against a codebase that
> already has them; use this as a spec to audit against instead.

Copy everything below into Claude Code (as your first message, or drop it in as
`PROJECT.md` and tell Claude Code to read it and start).

## Project brief

Build a full-stack small-business accounting web app that matches and exceeds
Wave Accounting's feature set. Priorities: correct double-entry bookkeeping
under the hood, a fast/clean UI, and a genuinely working 1099 contractor
workflow (collect W-9 → track payments → generate forms → e-file with the
IRS) — this last part is Wave's weakest area and the main reason this app
needs to exist.

Work incrementally. After each phase below, stop, show me what you built/how
to run it, and wait for confirmation before moving to the next phase. Ask me
clarifying questions before phase 1 if anything here is ambiguous — don't
guess silently on data-model or compliance decisions.

## Tech stack (use this unless you have a strong reason not to — tell me if so)

- Frontend: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
- Backend: Next.js API routes / server actions, or a separate Node/Express
  service if the domain logic gets heavy — your call, explain the tradeoff
- Database: PostgreSQL (this is a ledger — we need real transactions/constraints,
  not a document store) via Prisma or Drizzle
- Auth: email/password + OAuth (support multi-user orgs with roles: owner,
  accountant, employee, contractor-view-only)
- File storage: S3-compatible bucket for receipts, W-9s, generated PDFs
- PDF generation: for invoices, 1099s, financial statements
- Background jobs: for recurring invoices, bank sync polling, month-end close
  reminders, e-file batch submission
- Payments: Stripe Connect (invoice payments + eventually contractor payouts)
- Bank feeds: Plaid for transaction import/reconciliation

## Core accounting engine (build this first — it's the foundation everything else sits on)

- Real double-entry bookkeeping: every transaction is a set of balanced
  debit/credit entries against a Chart of Accounts, not just a flat list of
  "income/expense" rows. This is the #1 thing to get right architecturally
  before building UI on top of it.
- Standard chart of accounts template on signup (Assets, Liabilities, Equity,
  Income, Expenses, COGS), editable/extensible per business.
- Immutable ledger: transactions post once; corrections happen via
  reversing/adjusting entries, never silent edits, so there's always an audit
  trail.
- Multi-currency support (store amounts in minor units/cents, never floats).
- Fiscal year config, accounting basis (cash vs. accrual) — Wave forces
  cash-ish behavior in places; support real accrual.

## Feature parity with Wave (table stakes)

- Invoicing: recurring invoices, partial payments, late fees, custom
  templates, client portal to view/pay online, automatic payment reminders.
- Estimates/quotes convertible to invoices.
- Expense tracking: manual entry + receipt photo upload with OCR line-item
  extraction, categorization to chart of accounts, mileage tracking.
- Bank & credit card connections: Plaid-based import, auto-categorization
  (rules + ML suggestions), reconciliation workflow against statements.
- Reports: Profit & Loss, Balance Sheet, Cash Flow Statement, Trial Balance,
  Sales Tax report, Aged Receivables/Payables — all exportable (PDF/CSV) and
  date-range filterable.
- Multiple businesses per login, multiple bank accounts per business.
- Payroll-lite: at minimum, track contractor and vendor payments in a way
  that feeds 1099 reporting (see below). Full W-2 payroll is a stretch goal —
  call it out as phase 2+.
- Sales tax tracking by jurisdiction on invoices/expenses.

## Where this beats Wave: the 1099 module (this is the differentiator — build it carefully)

Ground rules from current IRS requirements (verify against IRS.gov before
shipping, rules shift year to year):

- W-9 collection: each vendor/contractor record supports a secure W-9
  request-and-upload flow (or structured data entry: name, TIN, entity type,
  address) before they can be marked 1099-eligible. Store TIN encrypted at
  rest.
- Payment tracking for 1099 purposes: every vendor payment made in the app
  (bill pay, expense marked "paid to vendor", ACH/check log) accumulates
  against that vendor's calendar-year total, split by box type (NEC
  nonemployee comp, MISC rent/royalties/other, INT, DIV as needed). Exclude
  payments made by credit card/third-party network (those are 1099-K
  territory, reported by the processor, not the payer) — get this exclusion
  right, it's a common compliance bug.
- Threshold logic must be configurable, not hardcoded: the federal
  1099-NEC/MISC minimum reporting threshold changed from $600 to $2,000 for
  tax years beginning after 2025 (with inflation adjustments starting 2027),
  so store the threshold as a per-tax-year lookup value, not a constant. Flag
  vendors approaching/crossing the threshold in the UI as payments accrue.
- Form generation: generate 1099-NEC and 1099-MISC (and stub out INT/DIV) as
  filled PDFs (Copy A, B, C) from accumulated payment data, with a
  review/edit step before filing — never auto-file without user
  confirmation.
- E-filing: the IRS retired the legacy FIRE system; IRIS (Information
  Returns Intake System) is now the primary e-file portal, required for tax
  year 2026 filings onward. Build this as an integration layer with a
  pluggable transmitter, because there are two realistic paths and you
  should support both:
  1. Direct IRIS integration — requires the business to have their own
     Transmitter Control Code (TCC) from the IRS (an application that takes
     ~45 business days), then submit via IRIS's Application-to-Application
     (A2A) API or its browser portal. Best for an app the business runs
     entirely themselves at scale.
  2. Third-party e-file provider API (e.g. Track1099/Tax1099-style
     services) as a fallback/default — much faster to integrate, no TCC
     wait, better for get-to-market speed. Recommend starting here and
     adding direct IRIS as a phase-2 "power user" option.
- E-file threshold logic: electronic filing is mandatory once a business's
  combined information returns (1099s + W-2s + other covered returns) hit 10
  for the year — track this aggregate count and warn the user, don't let
  them assume paper filing is fine because any single form type is under 10.
- Recipient copies: deliver Copy B to contractors electronically (with
  e-consent capture, which the IRS requires for electronic-only delivery) or
  via mailed PDF, by the January 31 deadline.
- State filing: support the Combined Federal/State Filing (CF/SF) program
  where the state participates, and flag states that require separate
  direct filing.
- Corrections workflow: support filing corrected 1099s against a previously
  filed one, tracked as a linked correction record, not a new independent
  form.
- Audit trail: every generated/filed 1099 is versioned and immutable once
  submitted to the IRS; corrections create new versions.

## Where else to beat Wave (your call on priority, but consider)

- Real bank reconciliation UI (Wave's is famously weak) — a proper "match
  transaction to statement line" workflow with running variance shown.
- Better multi-entity support for people running several small businesses
  (LLCs, DBAs) from one login.
- Role-based permissions that actually work (bookkeeper/accountant access
  without owner-level exposure).
- An accountant-facing "close the books" checklist per period.
- API + webhooks for developers, since Wave has none of note.
- No degraded "free tier that upsells payroll/payments at a markup" dark
  patterns — decide our own pricing model separately, don't let it distort
  the data model.

## Non-negotiables / guardrails

- Never store raw TINs/SSNs/bank credentials in plaintext or logs. Encrypt
  at rest, redact in any error reporting.
- Every money field is an integer (cents), never a float.
- Every ledger-affecting action is logged with who/when for audit purposes.
- Don't build the actual IRS e-file submission call in a way that can fire
  without an explicit human "Submit to IRS" confirmation click — this is a
  hard compliance/legal-liability line.
- Treat IRS threshold/deadline numbers as configuration, not code constants,
  since they change yearly — and tell me explicitly if you're relying on IRS
  data you haven't verified is current.

## Suggested build order

1. **Phase 1 — Ledger core**: chart of accounts, double-entry engine, manual
   journal entries, basic P&L/Balance Sheet.
2. **Phase 2 — Invoicing & expenses**: invoices, estimates, expense entry,
   receipt upload.
3. **Phase 3 — Bank integration**: Plaid connection, transaction import,
   categorization, reconciliation.
4. **Phase 4 — Vendors & 1099 tracking**: vendor records, W-9 collection,
   payment accumulation, threshold monitoring.
5. **Phase 5 — 1099 generation & e-file**: PDF generation, third-party
   e-file provider integration, recipient delivery, corrections.
6. **Phase 6 — Reports, multi-entity, roles, polish.**

Start by proposing the concrete data model (Prisma/Drizzle schema) for Phase 1
and ask me anything you need clarified before writing code.
