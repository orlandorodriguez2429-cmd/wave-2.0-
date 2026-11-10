// Statement upload — the fallback for banks or clients that won't use Plaid.
// CSV in, same import pipeline out (dedupe → suggestions → auto-categorize).
//
// Balance check before anything is saved:
//   bank account:  opening + Σ(transactions) = closing
//   credit card:   opening owed − Σ(transactions) = closing owed
// (our sign convention: negative = money out / a charge).
//
// Dedupe: rows are matched by (date, amount) against what the account
// already holds — from an earlier upload OR from a live feed — and only the
// excess is imported, so re-uploading or overlapping statements never
// double-count.
import { prisma } from '@/lib/db';
import { formatMoney, parseAmount } from '@/lib/money';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { createFeedLedgerAccount } from './import';
import { suggestAccount } from './suggest';
import { autoCategorize, type AutoStats } from './autocat';

export interface StatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  amount: bigint; // signed, negative = money out
}

/** Minimal RFC-4180 CSV reader (quotes, escaped quotes, CRLF). */
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

/** "$1,234.56", "(12.00)", "-12" → signed minor units. Empty → null. */
export function parseMoneyCell(raw: string, currency: string): bigint | null {
  let s = raw.trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const v = parseAmount(s, currency);
  return negative ? -v : v;
}

const COLS = {
  date: ['date', 'posted date', 'posting date', 'transaction date', 'trans date'],
  description: ['description', 'memo', 'payee', 'details', 'name', 'transaction'],
  amount: ['amount', 'transaction amount'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'money in'],
};

export function parseStatementCsv(
  text: string,
  currency: string,
  opts: { positiveIsMoneyOut?: boolean } = {},
): StatementRow[] {
  const rows = readCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) throw new LedgerValidationError('The file has no transactions.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iDate = find(COLS.date);
  const iDesc = find(COLS.description);
  const iAmt = find(COLS.amount);
  const iDebit = find(COLS.debit);
  const iCredit = find(COLS.credit);
  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && (iDebit < 0 || iCredit < 0))) {
    throw new LedgerValidationError(
      'Could not find the columns. The CSV needs a header with Date, Description and either Amount or Debit + Credit.',
    );
  }
  const out: StatementRow[] = [];
  rows.slice(1).forEach((r, n) => {
    const date = parseDate(r[iDate] ?? '');
    if (!date) throw new LedgerValidationError(`Row ${n + 2}: unreadable date "${r[iDate] ?? ''}".`);
    let amount: bigint;
    try {
      if (iAmt >= 0) {
        amount = parseMoneyCell(r[iAmt] ?? '', currency) ?? 0n;
        if (opts.positiveIsMoneyOut) amount = -amount;
      } else {
        const debit = parseMoneyCell(r[iDebit] ?? '', currency) ?? 0n;
        const credit = parseMoneyCell(r[iCredit] ?? '', currency) ?? 0n;
        amount = (credit < 0n ? -credit : credit) - (debit < 0n ? -debit : debit);
      }
    } catch {
      throw new LedgerValidationError(`Row ${n + 2}: unreadable amount.`);
    }
    const description = (r[iDesc] ?? '').trim() || 'Statement line';
    if (amount !== 0n) out.push({ date, description, amount });
  });
  if (out.length === 0) throw new LedgerValidationError('The file has no non-zero transactions.');
  return out;
}

export async function importStatement(opts: {
  businessId: string;
  userId: string;
  fileName: string;
  csvText: string;
  openingBalance: string;
  closingBalance: string;
  positiveIsMoneyOut?: boolean;
  /** Existing account to load into… */
  linkId?: string;
  /** …or a new manual account. */
  newAccount?: { name: string; kind: 'depository' | 'credit' };
}): Promise<{ uploadId: string; imported: number; duplicates: number; auto: AutoStats | null }> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  const currency = business.functionalCurrency;
  const rows = parseStatementCsv(opts.csvText, currency, { positiveIsMoneyOut: opts.positiveIsMoneyOut });

  let link = opts.linkId ? await prisma.bankAccountLink.findUnique({ where: { id: opts.linkId } }) : null;
  if (opts.linkId && (!link || link.businessId !== opts.businessId)) throw new LedgerValidationError('Unknown account.');
  const kind = link?.type === 'credit' || opts.newAccount?.kind === 'credit' ? 'credit' : 'depository';

  const opening = parseMoneyCell(opts.openingBalance, currency);
  const closing = parseMoneyCell(opts.closingBalance, currency);
  if (opening === null || closing === null) throw new LedgerValidationError('Enter the opening and closing balance from the statement.');
  const sum = rows.reduce((s, r) => s + r.amount, 0n);
  const expectedClosing = kind === 'credit' ? opening - sum : opening + sum;
  if (expectedClosing !== closing) {
    throw new LedgerValidationError(
      `Balance check failed: opening ${formatMoney(opening, currency)} ${kind === 'credit' ? '−' : '+'} transactions ${formatMoney(kind === 'credit' ? -sum : sum, currency)} = ${formatMoney(expectedClosing, currency)}, but the statement says ${formatMoney(closing, currency)} (off by ${formatMoney(closing - expectedClosing, currency)}). Check the file and the balances; nothing was imported.`,
    );
  }

  if (!link) {
    const name = opts.newAccount?.name.trim();
    if (!name) throw new LedgerValidationError('Name the account (e.g. "Chase Checking 1234").');
    const created = await prisma.$transaction(async (tx) => {
      const ledger = await createFeedLedgerAccount(tx, opts.businessId, currency, name, {
        externalAccountId: 'upload',
        name: kind === 'credit' ? 'Credit Card' : 'Account',
        mask: null,
        currency,
        type: kind,
        subtype: kind === 'credit' ? 'credit card' : 'checking',
      });
      return tx.bankConnection.create({
        data: {
          businessId: opts.businessId,
          provider: 'upload',
          institutionName: name,
          createdById: opts.userId,
          accounts: {
            create: {
              businessId: opts.businessId,
              externalAccountId: 'upload-1',
              name: kind === 'credit' ? 'Credit Card (statements)' : 'Account (statements)',
              currency,
              type: kind,
              subtype: kind === 'credit' ? 'credit card' : 'checking',
              ledgerAccountId: ledger.id,
            },
          },
        },
        include: { accounts: true },
      });
    });
    link = created.accounts[0];
  }

  // Dedupe by (date, amount) against what this account already holds.
  const dates = rows.map((r) => new Date(r.date));
  const existing = await prisma.importedTransaction.findMany({
    where: {
      bankAccountLinkId: link.id,
      date: { gte: new Date(Math.min(...dates.map((d) => d.getTime()))), lte: new Date(Math.max(...dates.map((d) => d.getTime()))) },
    },
    select: { date: true, amount: true },
  });
  const have = new Map<string, number>();
  for (const e of existing) {
    const k = `${e.date.toISOString().slice(0, 10)}|${e.amount}`;
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const toImport: Array<StatementRow & { externalId: string }> = [];
  for (const r of rows) {
    const k = `${r.date}|${r.amount}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n <= (have.get(k) ?? 0)) continue; // already on file
    toImport.push({ ...r, externalId: `stmt:${r.date}:${r.amount}:${n}` });
  }

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const upload = await prisma.statementUpload.create({
    data: {
      businessId: opts.businessId,
      bankAccountLinkId: link.id,
      fileName: opts.fileName.slice(0, 200),
      periodStart: new Date(sorted[0].date),
      periodEnd: new Date(sorted[sorted.length - 1].date),
      openingBalance: opening,
      closingBalance: closing,
      rowCount: rows.length,
      importedCount: toImport.length,
      createdById: opts.userId,
    },
  });
  const data = [];
  for (const r of toImport) {
    const s = await suggestAccount(opts.businessId, r.description, r.amount);
    data.push({
      businessId: opts.businessId,
      bankAccountLinkId: link.id,
      externalId: r.externalId,
      date: new Date(r.date),
      description: r.description,
      amount: r.amount,
      statementUploadId: upload.id,
      suggestedAccountId: s?.accountId ?? null,
      suggestedByRuleId: s?.ruleId ?? null,
    });
  }
  const created = await prisma.importedTransaction.createMany({ data, skipDuplicates: true });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'statement.uploaded',
      entityType: 'statement_upload',
      entityId: upload.id,
      payload: { rows: rows.length, imported: created.count, duplicates: rows.length - created.count },
    },
  });
  const auto = await autoCategorize({ businessId: opts.businessId }).catch(() => null);
  return { uploadId: upload.id, imported: created.count, duplicates: rows.length - created.count, auto };
}
