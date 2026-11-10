// Run a bank sync for one connection: page through the provider from the
// saved cursor, plan the changes (sync-plan.ts), and apply them plus the new
// cursor in ONE database transaction. If anything fails, nothing is applied
// and the cursor stays put, so the next run re-fetches the same changes.
// The ledger is never touched here — imported rows only.
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { MockBankProvider, SyncRestartRequired, type BankFeedProvider, type SyncPage } from './provider';
import { PlaidProvider } from './plaid';
import { PlaidRequestError, RECONNECT_ERROR_CODES } from './plaid-client';
import { planSync, rowKey, type ExistingRow, type SyncStats } from './sync-plan';
import { suggestAccount } from './suggest';
import { autoCategorize, type AutoStats } from './autocat';
import type { Classifier } from './ai-categorize';

/** Statement-upload accounts have no live feed: syncing them is a no-op. */
const NO_FEED: BankFeedProvider = {
  name: 'upload',
  syncPage: async (_token, cursor) => ({ added: [], modified: [], removed: [], nextCursor: cursor ?? '', hasMore: false }),
};

export function getProvider(name: string): BankFeedProvider {
  if (name === 'plaid') return new PlaidProvider();
  if (name === 'upload') return NO_FEED;
  return new MockBankProvider();
}

export type SyncTrigger = 'manual' | 'connect' | 'webhook' | 'cron';

export interface SyncResult extends SyncStats {
  /** Kept for callers that only care how many rows arrived. */
  imported: number;
  auto?: AutoStats;
}

const MAX_ATTEMPTS = 3;
const MAX_PAGES = 200; // 200 × 500 txns — a runaway guard, not a real limit.

class CursorMovedError extends Error {}

export async function syncConnection(opts: {
  connectionId: string;
  /** When given, the connection must belong to this business. */
  businessId?: string;
  /** Null for system-triggered syncs (webhook, cron). */
  userId: string | null;
  trigger?: SyncTrigger;
  /** Test seam: override the provider. */
  provider?: BankFeedProvider;
  /** Run rules/merchant/AI categorization after importing (default true). */
  autoCategorize?: boolean;
  /** Test seam / opt-out for the AI step (undefined = use ANTHROPIC_API_KEY if set). */
  classifier?: Classifier | null;
}): Promise<SyncResult> {
  const trigger = opts.trigger ?? 'manual';
  const initial = await prisma.bankConnection.findUniqueOrThrow({
    where: { id: opts.connectionId },
    include: { accounts: true },
  });
  if (opts.businessId && initial.businessId !== opts.businessId) throw new Error('Wrong business.');
  if (initial.status === 'REMOVED') throw new Error('This bank connection was disconnected.');

  const provider = opts.provider ?? getProvider(initial.provider);
  const accessToken = initial.accessTokenEncrypted ? decryptSecret(initial.accessTokenEncrypted) : null;
  const links = new Map(initial.accounts.map((a) => [a.externalAccountId, a.id]));

  for (let attempt = 1; ; attempt++) {
    const { cursor: startCursor } = await prisma.bankConnection.findUniqueOrThrow({
      where: { id: initial.id },
      select: { cursor: true },
    });

    // 1. Fetch every page from the saved cursor.
    let pages: SyncPage[];
    try {
      pages = await fetchAllPages(provider, accessToken, startCursor);
    } catch (err) {
      if (err instanceof SyncRestartRequired && attempt < MAX_ATTEMPTS) continue;
      await recordSyncFailure(initial.id, initial.businessId, opts.userId, trigger, err);
      throw err;
    }
    const finalCursor = pages.length ? pages[pages.length - 1].nextCursor : startCursor;

    // 2. Plan against the rows we already hold for the ids mentioned.
    const ids = new Set<string>();
    for (const p of pages) {
      for (const t of [...p.added, ...p.modified, ...p.removed]) ids.add(t.externalId);
    }
    const rows = ids.size
      ? await prisma.importedTransaction.findMany({
          where: { bankAccountLinkId: { in: [...links.values()] }, externalId: { in: [...ids] } },
          select: { id: true, bankAccountLinkId: true, externalId: true, status: true, date: true, description: true, amount: true },
        })
      : [];
    const existing = new Map<string, ExistingRow>(
      rows.map((r) => [
        rowKey(r.bankAccountLinkId, r.externalId),
        {
          id: r.id,
          linkId: r.bankAccountLinkId,
          externalId: r.externalId,
          status: r.status,
          date: r.date.toISOString().slice(0, 10),
          description: r.description,
          amount: r.amount,
        },
      ]),
    );
    const plan = planSync({ links, existing, pages });

    // 3. Category suggestions (rules / history) for new and changed rows.
    const suggestions = new Map<string, Awaited<ReturnType<typeof suggestAccount>>>();
    for (const t of [...plan.inserts.map((i) => i.txn), ...plan.updates.map((u) => u.txn)]) {
      suggestions.set(t.externalId, await suggestAccount(initial.businessId, t.description, t.amount));
    }

    // 4. Apply atomically, guarded against a concurrent sync moving the cursor.
    try {
      await prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<{ cursor: string | null }[]>`
            SELECT "cursor" FROM "bank_connections" WHERE "id" = ${initial.id} FOR UPDATE`;
          if ((locked[0]?.cursor ?? null) !== startCursor) throw new CursorMovedError();

          if (plan.inserts.length) {
            await tx.importedTransaction.createMany({
              data: plan.inserts.map(({ linkId, txn }) => {
                const s = suggestions.get(txn.externalId);
                return {
                  businessId: initial.businessId,
                  bankAccountLinkId: linkId,
                  externalId: txn.externalId,
                  date: new Date(txn.date),
                  description: txn.description,
                  amount: txn.amount,
                  merchantName: txn.merchantName ?? null,
                  providerCategory: txn.providerCategory ?? null,
                  suggestedAccountId: s?.accountId ?? null,
                  suggestedByRuleId: s?.ruleId ?? null,
                };
              }),
              skipDuplicates: true,
            });
          }

          for (const u of plan.updates) {
            const s = suggestions.get(u.txn.externalId);
            // Status guard: if someone posted it since we planned, flag instead.
            const res = await tx.importedTransaction.updateMany({
              where: { id: u.id, status: { in: ['PENDING', 'EXCLUDED'] } },
              data: {
                date: new Date(u.txn.date),
                description: u.txn.description,
                amount: u.txn.amount,
                merchantName: u.txn.merchantName ?? null,
                providerCategory: u.txn.providerCategory ?? null,
                suggestedAccountId: s?.accountId ?? null,
                suggestedByRuleId: s?.ruleId ?? null,
              },
            });
            if (res.count === 0) {
              plan.flags.push({
                id: u.id,
                reason: 'PROVIDER_MODIFIED',
                change: { date: u.txn.date, description: u.txn.description, amount: u.txn.amount.toString() },
              });
            }
          }

          if (plan.deletes.length) {
            const res = await tx.importedTransaction.deleteMany({
              where: { id: { in: plan.deletes }, status: { in: ['PENDING', 'EXCLUDED'] } },
            });
            if (res.count !== plan.deletes.length) {
              // Some were posted meanwhile: those get flagged, never deleted.
              const survivors = await tx.importedTransaction.findMany({
                where: { id: { in: plan.deletes } },
                select: { id: true },
              });
              for (const s of survivors) plan.flags.push({ id: s.id, reason: 'PROVIDER_REMOVED', change: null });
            }
          }

          for (const f of plan.flags) {
            await tx.importedTransaction.update({
              where: { id: f.id },
              data: { needsReview: true, reviewReason: f.reason, providerChange: f.change ?? Prisma.DbNull },
            });
          }

          await tx.bankConnection.update({
            where: { id: initial.id },
            data: {
              cursor: finalCursor,
              lastSyncAt: new Date(),
              syncRequestedAt: null,
              // A good sync clears a generic error; NEEDS_RECONNECT is only
              // cleared by the bank login being repaired.
              ...(initial.status === 'ERROR' ? { status: 'ACTIVE' as const, errorCode: null } : {}),
            },
          });

          const stats = { ...plan.stats, flagged: plan.flags.length };
          await tx.auditLog.create({
            data: {
              businessId: initial.businessId,
              userId: opts.userId,
              action: 'bank_connection.synced',
              entityType: 'bank_connection',
              entityId: initial.id,
              payload: { trigger, ...stats },
            },
          });
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } catch (err) {
      if (err instanceof CursorMovedError && attempt < MAX_ATTEMPTS) continue;
      if (err instanceof CursorMovedError) {
        // Another sync already applied these changes; nothing left to do.
        return { ...plan.stats, added: 0, updated: 0, deleted: 0, flagged: 0, imported: 0 };
      }
      throw err;
    }

    const result: SyncResult = { ...plan.stats, flagged: plan.flags.length, imported: plan.stats.added };
    if (opts.autoCategorize !== false) {
      try {
        result.auto = await autoCategorize({ businessId: initial.businessId, classifier: opts.classifier });
      } catch (err) {
        // Import already committed; categorization can run again later.
        console.warn(`[sync] auto-categorize failed: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }
    return result;
  }
}

async function fetchAllPages(provider: BankFeedProvider, accessToken: string | null, cursor: string | null) {
  const pages: SyncPage[] = [];
  let next = cursor;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await provider.syncPage(accessToken, next);
    pages.push(page);
    next = page.nextCursor;
    if (!page.hasMore) return pages;
  }
  throw new Error('Bank sync returned too many pages; stopping.');
}

/** Map a provider failure to a connection status. Logs only the error code. */
async function recordSyncFailure(
  connectionId: string,
  businessId: string,
  userId: string | null,
  trigger: SyncTrigger,
  err: unknown,
) {
  const code = err instanceof PlaidRequestError ? err.code : null;
  const needsReconnect = code !== null && RECONNECT_ERROR_CODES.has(code);
  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: { status: needsReconnect ? 'NEEDS_RECONNECT' : 'ERROR', errorCode: code ?? 'SYNC_FAILED' },
  });
  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action: 'bank_connection.sync_failed',
      entityType: 'bank_connection',
      entityId: connectionId,
      payload: { trigger, errorCode: code ?? 'SYNC_FAILED' },
    },
  });
}
