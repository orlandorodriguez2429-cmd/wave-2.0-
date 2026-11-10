# Security — Your Tax Solution Books

This document describes how the application protects client financial data.
It is written to support (1) Plaid's production security questionnaire and
(2) the office's Written Information Security Plan (WISP) under the FTC
Safeguards Rule (16 CFR Part 314) and IRS Publication 4557.

It describes **what the software does**. Items in **[brackets]** are
operational facts only the owner can supply (people, vendors chosen, dates).
Keep this file current: review it at least once a year and after any
significant change or incident.

| Item | Value |
| --- | --- |
| Qualified Individual (Safeguards Rule) | [Name, role] |
| Security contact (incidents, questions) | [email] · [phone] |
| Last reviewed | [date] |

---

## 1. Data the app holds

| Data | Where | Protection |
| --- | --- | --- |
| Bank access tokens (Plaid `access_token`) | `bank_connections.accessTokenEncrypted` | AES-256-GCM at rest; never logged, never sent to a browser, never in the audit log; deleted when a bank is disconnected |
| Bank usernames / passwords | **Never received or stored** | Bank sign-in happens inside Plaid Link |
| Bank account numbers | **Never received** | Only account name and last 4 digits (`mask`) are stored |
| Bank transactions | `imported_transactions` | Database encryption at rest (host), access control below |
| Contractor TINs/SSNs, business EINs | `vendors`, `businesses` | AES-256-GCM at rest + last 4 stored separately for display; masked in the UI; never in logs or audit payloads |
| MFA secrets | `users.mfaSecretEncrypted` | AES-256-GCM |
| MFA backup codes | `mfa_backup_codes` | SHA-256 hashes only; single use |
| Passwords | `users.passwordHash` | bcrypt (cost 12); minimum 12 characters for new accounts |
| Invitation links, API tokens | `invites`, `api_tokens` | SHA-256 hashes only |

Encryption key: `ENCRYPTION_KEY` (32 random bytes) from the environment —
never in the repository. Ciphertext is versioned (`v1:`) to allow rotation.

## 2. Access control

- **Roles per business:** OWNER, ACCOUNTANT, EMPLOYEE, CONTRACTOR_VIEW (staff)
  and CLIENT (the business's own owner, read-only portal). Every mutating
  server action states the minimum role it requires.
- **Clients are fenced three ways:**
  1. Middleware: a CLIENT session can only reach `/client/**`; every other
     route returns 404. Staff sessions cannot reach `/client/**`.
  2. Server: every staff page, action and route handler goes through
     `getCurrentContext()`, which returns 404 for any CLIENT login.
  3. Data: every portal query is scoped to the single business on the
     client's membership — never to an id from the URL or a form. A client
     login can never be attached to a second business.
  Automated tests enumerate every route in the app and prove the 404s, and
  prove a client cannot use another business's ids in its own actions.
- **Least privilege for staff:** staff only see businesses they are members
  of; removing a member or changing roles ends their sessions immediately.

## 3. Authentication

- **Two-step verification (TOTP, RFC 6238) is required for every login** —
  staff and clients. A full session only exists after the second step.
  Codes cannot be replayed. Ten one-time backup codes are issued at setup.
  An owner can reset a member's two-step (lost phone), which ends that
  member's sessions.
- **Rate limits:** login per IP (20 / 15 min) and per email (8 / 15 min);
  MFA per user (6 / 10 min); invitations per business and per IP.
- **Lockout:** 10 consecutive failures (password or code) lock the account
  for 15 minutes. Unknown emails take the same time as known ones.
- **Sessions:** signed (HMAC-SHA-256) cookies that are `HttpOnly`, `Secure`
  (production), `SameSite=Lax`, and `__Host-` prefixed in production. Idle
  timeout 30 minutes for staff, 2 hours for clients; 12-hour absolute limit.
  Each session carries a version; role changes, removal, MFA setup/reset and
  business deletion invalidate all earlier sessions. Switching business
  issues a new token.
- **Client invitations:** single-use links, stored only as a hash, valid 72
  hours; a newer invitation cancels older ones. The client sets their own
  password and must set up two-step before seeing anything.

## 4. Encryption in transit

- All traffic is HTTPS (terminated by the host; HSTS sent in production).
- Plaid, Anthropic and SMTP connections use TLS (SMTP requires STARTTLS on
  port 587 or TLS on 465).

## 5. Logging and monitoring

- **Audit log** (per business, append-only in the app): sign-ins, MFA events,
  invitations, every ledger posting/reversal, every categorization and how it
  was decided (person / rule / built-in rule / AI with confidence / transfer),
  month close/reopen (with reason), bank connect/sync/webhook/disconnect,
  statement uploads, rule changes, deletions.
- **Staff views of client data** are logged (who, which business, which
  page, when — at most once per person/business/page per 15 minutes).
- Secrets are never written to logs. Plaid errors are reduced to Plaid's
  error code before logging (the Plaid SDK's raw errors contain the API
  secret in request headers and are never logged).
- [Host log retention period and who reviews alerts.]

## 6. Third parties (vendors)

| Vendor | Purpose | Data shared | Notes |
| --- | --- | --- | --- |
| Plaid | Bank connections | Bank sign-in happens at Plaid; we receive account names, last 4, transactions | Webhooks verified (signed JWT + body hash) |
| [Host, e.g. Render] | App + Postgres hosting, backups | Everything in the database (encrypted fields stay encrypted) | [SOC 2 report on file? date] |
| [SMTP provider] | Invitation and notification email | Recipient email, message text (no financial data) | |
| Anthropic | AI categorization fallback | Only: cleaned transaction description (names after Zelle/Venmo/transfer keywords, account and reference numbers, emails removed), amount, date, money in/out, bank vs card, Plaid's coarse category, the business type typed by staff, and the category list. **Never** names, emails, account numbers, TINs/SSNs, institution names or internal ids. | Optional; without `ANTHROPIC_API_KEY` nothing is sent |

Review each vendor's security attestations annually [and record where].

## 7. Data retention and disposal

- Disconnecting a bank calls Plaid `/item/remove` and wipes the stored token;
  already-imported history stays with the books.
- Deleting a business (owner only, must type the name) first removes every
  Plaid item, then deletes all of the business's data in one transaction,
  and keeps a deletion record (who, when, counts). Export anything that law
  requires you to keep (e.g. filed 1099 copies, records supporting returns)
  **before** deleting.
- [Retention schedule for client records, per the office's WISP.]

## 8. Secure development

- Secrets only in environment variables. In production the server refuses
  to start without `ENCRYPTION_KEY`, `PLAID_*`, `CRON_SECRET` and an https
  `APP_URL`.
- The ledger is append-only: posted entries cannot be edited (enforced by
  database triggers); corrections are reversing entries.
- Integer cents everywhere; no floating-point money.
- Automated test suite (unit + database integration) runs before each
  release; `npm audit` reviewed on dependency updates.
- No demo data is loaded in production (`SEED_DEMO_DATA` must not be set).

## 9. Backups and restore

- Managed Postgres with automated daily backups [and point-in-time
  recovery — per host plan]. See DEPLOY.md § "Backups and restore".
- A test restore is performed [quarterly] and recorded: [date · who · result].
- `ENCRYPTION_KEY` must be backed up separately and securely (password
  manager / sealed record). **A database backup is useless without it.**

## 10. Incident response

1. Contain: rotate `ENCRYPTION_KEY`-dependent secrets as needed, revoke
   sessions (bump `sessionVersion` for affected users), disable affected
   logins, rotate `PLAID_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, SMTP
   password in the host dashboard.
2. Assess: use the audit log (who viewed/changed what, when) and host logs.
3. Notify: [Qualified Individual] decides on notifications. The FTC
   Safeguards Rule requires notifying the FTC within 30 days of discovering
   an event involving unencrypted information of 500+ consumers. Notify the
   IRS Stakeholder Liaison for your area if taxpayer data is involved; follow
   state breach laws; notify Plaid per its terms if Plaid data is affected.
4. Recover and record lessons learned.

Contacts: [Qualified Individual] · [IT/host support] · [IRS Stakeholder
Liaison for your state] · [cyber insurance carrier, if any].

## 11. Things this app does not do (yet)

- PDF statements are not parsed (CSV only).
- No automatic key rotation tool (ciphertext format supports it).
- No built-in SIEM/alerting; rely on host alerts [configure].
