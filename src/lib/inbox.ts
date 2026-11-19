// Statement inbox: drop any number of PDF bank statements (any clients, any
// months) and each one is handled end to end:
//   1. read it on our server (no AI): transactions, balances, and the header
//      (bank, business name, last 4 digits, card or checking, period);
//   2. file it: the account with the same last 4 at the same bank → the
//      client with the same business name → otherwise a NEW client named from
//      the statement (books start the statement's first month);
//   3. import with the balance check (nothing is saved if it doesn't add up),
//      skipping lines already on file;
//   4. sort automatically (transfers, rules, built-in rules, AI if enabled);
//   5. close every month that is now safe to close (see autoCloseMonths).
// Only the person's own businesses (OWNER/ACCOUNTANT) are searched or used.
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { autoCategorize } from '@/lib/banking/autocat';
import { importStatement } from '@/lib/banking/statement';
import { pdfToLines, parseStatementLines } from '@/lib/banking/statement-pdf';
import { nameKey, readStatementInfo, tidyName, type StatementInfo } from '@/lib/banking/statement-info';
import { systemUserId } from '@/lib/banking/system-user';
import { autoCloseMonths } from '@/lib/months';

export interface InboxResult {
  fileName: string;
  ok: boolean;
  error?: string;
  businessId?: string;
  businessName?: string;
  createdClient?: boolean;
  createdAccount?: boolean;
  account?: string;
  period?: string;
  imported?: number;
  duplicates?: number;
  autoSorted?: number;
  toReview?: number;
  closedMonths?: string[];
  notClosedBecause?: string;
  /** Lines that landed in a month that was already closed. */
  inClosedMonth?: number;
  uploadId?: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

async function findTarget(userId: string, info: StatementInfo) {
  const memberships = await prisma.membership.findMany({
    where: { userId, role: { in: ['OWNER', 'ACCOUNTANT'] } },
    include: { business: true },
  });
  const businessIds = memberships.map((m) => m.businessId);
  const bankWord = (info.bankName ?? '').toLowerCase().split(/\s+/).find((w) => w.length >= 3) ?? '';

  // 1. Same last 4 digits on an account in one of my businesses.
  if (info.mask) {
    const links = await prisma.bankAccountLink.findMany({
      where: { businessId: { in: businessIds }, mask: info.mask, connection: { status: { not: 'REMOVED' } } },
      include: { connection: true },
    });
    let candidates = links;
    if (candidates.length > 1 && bankWord) {
      candidates = candidates.filter((l) => l.connection.institutionName.toLowerCase().includes(bankWord));
    }
    if (candidates.length > 1 && info.holderName) {
      const key = nameKey(info.holderName);
      candidates = candidates.filter((l) => nameKey(memberships.find((m) => m.businessId === l.businessId)!.business.name) === key);
    }
    if (candidates.length === 1) {
      const l = candidates[0];
      const b = memberships.find((m) => m.businessId === l.businessId)!.business;
      return { business: b, linkId: l.id, createdClient: false };
    }
    if (candidates.length > 1) {
      throw new LedgerValidationError(
        `Several accounts end in ${info.mask} (${[...new Set(candidates.map((c) => memberships.find((m) => m.businessId === c.businessId)!.business.name))].join(', ')}). Upload it from that client's Bank accounts page instead.`,
      );
    }
  }

  // 2. A client with the same business name.
  if (info.holderName) {
    const key = nameKey(info.holderName);
    const match = memberships.find((m) => nameKey(m.business.name) === key);
    if (match) return { business: match.business, linkId: null, createdClient: false };
  }

  // 3. New client from the statement.
  if (!info.holderName) {
    throw new LedgerValidationError(
      "Couldn't read whose statement this is (no business name and no matching account). Upload it from the client's Bank accounts page instead.",
    );
  }
  const business = await createBusiness({ userId, name: info.holderName });
  return { business, linkId: null, createdClient: true };
}

export async function processStatementFile(opts: {
  userId: string;
  fileName: string;
  bytes: Uint8Array;
  today?: Date;
  /** Close finished months right away (single file). processInbox closes once at the end. */
  autoClose?: boolean;
  /** Sort right away (single file). processInbox sorts once all files are in, so transfers pair up. */
  sort?: boolean;
}): Promise<InboxResult> {
  const { fileName, bytes } = opts;
  const base: InboxResult = { fileName, ok: false };
  try {
    if (bytes.length > MAX_BYTES) throw new LedgerValidationError('File is larger than 10 MB.');
    if (!/\.pdf$/i.test(fileName)) {
      throw new LedgerValidationError(
        "Only PDF statements can be filed automatically (a CSV doesn't say whose it is). Upload CSVs from the client's Bank accounts page.",
      );
    }

    // Read everything first: nothing is created for a file we can't read.
    let lines: string[];
    try {
      lines = await pdfToLines(bytes);
    } catch {
      throw new LedgerValidationError('That file could not be opened as a PDF.');
    }
    const info = readStatementInfo(lines);
    const parsed = parseStatementLines(lines, 'USD');
    const first = [...parsed.rows].sort((a, b) => a.date.localeCompare(b.date))[0];
    const periodStart = info.periodStart ?? first.date;
    const periodEnd = info.periodEnd ?? parsed.rows.map((r) => r.date).sort().pop()!;
    if (parsed.openingBalance === null || parsed.closingBalance === null) {
      throw new LedgerValidationError('No opening/closing balance printed on this statement. Upload it from the client’s Bank accounts page and type the balances.');
    }

    // Balance check up front (bank: opening + lines = closing; card: opening −
    // lines = closing), so a bad file never creates a client. importStatement
    // repeats the check authoritatively against the account it lands in.
    const sum = parsed.rows.reduce((t, r) => t + r.amount, 0n);
    if (parsed.openingBalance + sum !== parsed.closingBalance && parsed.openingBalance - sum !== parsed.closingBalance) {
      throw new LedgerValidationError(
        "Balance check failed: the transactions on this statement don't add up to its ending balance, so nothing was imported. The PDF may be cut off or a page may be missing.",
      );
    }

    const target = await findTarget(opts.userId, info);
    const business = target.business;
    if (target.createdClient) {
      await prisma.business.update({
        where: { id: business.id },
        data: { booksStartDate: new Date(`${periodStart.slice(0, 7)}-01T00:00:00Z`) },
      });
    }

    const accountLabel = `${info.bankName ? tidyName(info.bankName) : 'Bank'} ${info.kind === 'credit' ? 'Card' : 'Checking'}${info.mask ? ` ${info.mask}` : ''}`.trim();
    let imported;
    try {
      imported = await importStatement({
        businessId: business.id,
        userId: opts.userId,
        fileName,
        pdf: bytes,
        openingBalance: '',
        closingBalance: '',
        period: { start: periodStart, end: periodEnd },
        skipAutoCategorize: true,
        ...(target.linkId ? { linkId: target.linkId } : { newAccount: { name: accountLabel, kind: info.kind, mask: info.mask } }),
      });
    } catch (err) {
      // Don't leave behind a client we created for a statement that failed.
      if (target.createdClient) {
        const { deleteBusiness } = await import('@/lib/retention');
        await deleteBusiness({ businessId: business.id, userId: opts.userId, confirmName: business.name, removePlaidItem: async () => {} }).catch(() => undefined);
        await prisma.deletionRecord.deleteMany({ where: { businessId: business.id } });
      }
      throw err;
    }

    const auto = opts.sort === false ? null : await autoCategorize({ businessId: business.id }).catch(() => null);
    const toReview = await prisma.importedTransaction.count({
      where: { businessId: business.id, OR: [{ status: 'PENDING' }, { needsReview: true }] },
    });
    const close = opts.autoClose === false ? null : await autoCloseMonths(business.id, await systemUserId(), opts.today);
    const closedThrough = (await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).booksClosedThrough;
    const inClosedMonth = closedThrough
      ? await prisma.importedTransaction.count({
          where: { statementUploadId: imported.uploadId, status: 'PENDING', date: { lte: closedThrough } },
        })
      : 0;

    await prisma.auditLog.create({
      data: {
        businessId: business.id,
        userId: opts.userId,
        action: 'inbox.statement_processed',
        entityType: 'statement_upload',
        entityId: imported.uploadId,
        payload: {
          createdClient: target.createdClient,
          imported: imported.imported,
          duplicates: imported.duplicates,
          closedMonths: close?.closed ?? [],
        },
      },
    });

    return {
      ...base,
      ok: true,
      businessId: business.id,
      businessName: business.name,
      createdClient: target.createdClient,
      createdAccount: !target.linkId,
      account: accountLabel,
      period: `${periodStart} – ${periodEnd}`,
      imported: imported.imported,
      duplicates: imported.duplicates,
      autoSorted: auto ? auto.transfers * 2 + auto.rule + auto.merchant + auto.ai : 0,
      toReview,
      closedMonths: close?.closed ?? [],
      notClosedBecause: close?.stoppedAt ? `${close.stoppedAt.month}: ${close.stoppedAt.reason}` : undefined,
      inClosedMonth,
      uploadId: imported.uploadId,
    };
  } catch (err) {
    if (err instanceof LedgerValidationError) return { ...base, error: err.message };
    console.warn(`[inbox] ${fileName}: ${err instanceof Error ? err.name : 'error'}`);
    return { ...base, error: 'Something went wrong reading this file. Try uploading it from the client’s Bank accounts page.' };
  }
}

/**
 * A whole drop of statements: file and import every one first, THEN decide
 * which months can close for each client touched. That way a client's card
 * statement in the same drop as its checking statement is counted before any
 * month closes.
 */
export async function processInbox(opts: {
  userId: string;
  files: Array<{ fileName: string; bytes: Uint8Array }>;
  today?: Date;
}): Promise<InboxResult[]> {
  const results: InboxResult[] = [];
  for (const f of opts.files) {
    results.push(
      await processStatementFile({ userId: opts.userId, fileName: f.fileName, bytes: f.bytes, today: opts.today, autoClose: false, sort: false }),
    );
  }
  const actor = await systemUserId();
  const businesses = [...new Set(results.filter((r) => r.ok).map((r) => r.businessId!))];
  for (const id of businesses) {
    // Sort once every file for this client is in: a card payment on the
    // checking statement pairs with "payment received" on the card statement.
    await autoCategorize({ businessId: id }).catch(() => null);
    const toReview = await prisma.importedTransaction.count({ where: { businessId: id, OR: [{ status: 'PENDING' }, { needsReview: true }] } });
    for (const r of results.filter((x) => x.businessId === id)) {
      r.autoSorted = await prisma.importedTransaction.count({
        where: { statementUploadId: r.uploadId, status: { in: ['CATEGORIZED', 'MATCHED'] } },
      });
      r.toReview = toReview;
    }
    const close = await autoCloseMonths(id, actor, opts.today);
    for (const r of results.filter((x) => x.businessId === id)) {
      r.closedMonths = close.closed;
      r.notClosedBecause = close.stoppedAt ? `${close.stoppedAt.month}: ${close.stoppedAt.reason}` : undefined;
    }
  }
  return results;
}
