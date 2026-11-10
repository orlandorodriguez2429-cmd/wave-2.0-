# Your Tax Solution Books

Month-to-month bookkeeping for a tax and bookkeeping office's clients:

1. **Bank in, automatically.** Each client connects their bank once (Plaid
   Link) — or you (or they) upload a PDF or CSV statement, which is only
   accepted if opening balance + transactions = closing balance. New transactions arrive by webhook,
   with a daily backstop sync.
2. **Sorted automatically.** Transfers between the client's own accounts,
   then your rules (including ones learned from your corrections), then
   built-in merchant rules, then an AI fallback. Only the unclear ones come
   to you. Balance-sheet items (transfers, card payments, owner draws, loans,
   sales tax) stay off the P&L; loan payments get an interest/principal split.
3. **Close each month.** Every month shows: not connected / no bank data /
   N to review / ready / closed. Closing is blocked while anything is
   unreviewed; reopening needs a reason and is audit-logged.
4. **Profit & Loss** any month, quarter or year, with PDF/CSV export.
5. **1099s:** W-9 collection, payment tracking with thresholds, form
   generation and e-file behind an explicit human "Submit to IRS" step.
6. **Client portal:** each client signs in (two-step verification required)
   and sees only their own business, read-only: dashboard, months, P&L,
   transactions, and their bank connection.
7. **All clients view** for the office: bank status, last sync, items to
   review, months not closed, 1099 watch — problems first.

Underneath: real double-entry bookkeeping (integer cents, immutable ledger,
corrections by reversal only), multi-business, roles, append-only audit log.

## Run it locally

Requirements: Node 20+, PostgreSQL 14+ (or just Docker).

**Docker (quickest):**

```bash
docker compose up
```

Open http://localhost:3000, sign in as `demo@wave2.local` / `demo-password-123`,
and set up two-step verification with any authenticator app.

**Without Docker:**

```bash
npm install
cp .env.example .env          # set DATABASE_URL and ENCRYPTION_KEY
npx prisma migrate deploy
npx prisma db seed            # demo business + sample data
npm run dev
```

Everything works without any external keys: the bank feed uses a built-in
sandbox, categorization uses rules (AI is skipped without a key), email is
printed to the server console.

Tests: `npx vitest run` (unit + database integration; needs `DATABASE_URL`).

## Configuration

See `.env.example` for every variable. The important ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres. |
| `ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts bank tokens, TINs, MFA secrets; signs sessions. Back it up — backups are unreadable without it. |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` / `PLAID_ENV` / `PLAID_WEBHOOK_URL` | Real bank connections (sandbox until Plaid approves production). |
| `ANTHROPIC_API_KEY` | Optional AI categorization fallback. |
| `CRON_SECRET` | Protects `POST /api/cron/sync` (daily backstop sync). |
| `APP_URL` | Public https address (invitation links). |
| `EMAIL_PROVIDER` + `SMTP_*` | `console` in development, `smtp` in production. |

In production the server refuses to start without `ENCRYPTION_KEY`,
`PLAID_*`, `CRON_SECRET` and an https `APP_URL`.

## Docs

- **[DEPLOY.md](./DEPLOY.md)** — hosting recommendation (Render), step-by-step
  deploy, migrations, Plaid webhook, daily sync, backups and test restore,
  production checklist.
- **[SECURITY.md](./SECURITY.md)** — access control, encryption, MFA, logging,
  vendors, retention, incident response. Written for Plaid's security
  questionnaire and the office's written information security plan.
- [PROJECT.md](./PROJECT.md) — the original product brief (historical).

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · PostgreSQL via Prisma 7 ·
Plaid (`plaid`, `react-plaid-link`) · Anthropic SDK · pdfkit · nodemailer ·
Vitest.
