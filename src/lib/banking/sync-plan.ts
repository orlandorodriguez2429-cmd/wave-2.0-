// Pure planning step of a bank sync: given the rows we already have and the
// pages a provider returned, decide what to insert, update, delete and flag.
// No database access here, so the rules are unit-tested against fixtures.
//
// Rules:
//   * Pending transactions are never imported. (When one posts, Plaid sends it
//     as a new `added` transaction; the pending one arrives as a `removed` for
//     an id we never stored, which is a no-op.)
//   * added    → insert (deduped on account + provider transaction id).
//   * modified → unposted row (PENDING/EXCLUDED): update it in place.
//                posted row (CATEGORIZED/MATCHED): never touched; if amount or
//                date changed, flag it for review with the new values.
//                Description-only changes on posted rows are ignored (Plaid
//                often cleans up merchant names after posting).
//   * removed  → unposted row: delete. Posted row: flag for review.
//   * Accounts we don't import (loans, investments, unknown) are skipped.
// Events are applied in page order against an in-memory view, so a
// transaction added and then modified/removed within the same run collapses
// correctly.
import type { ExternalTransaction, RemovedTransaction, SyncPage } from './provider';

export type RowStatus = 'PENDING' | 'CATEGORIZED' | 'MATCHED' | 'EXCLUDED';

export interface ExistingRow {
  id: string;
  linkId: string;
  externalId: string;
  status: RowStatus;
  date: string; // YYYY-MM-DD
  description: string;
  amount: bigint;
}

export interface PlannedInsert {
  linkId: string;
  txn: ExternalTransaction;
}

export interface PlannedUpdate {
  id: string;
  txn: ExternalTransaction;
}

export type ReviewReason = 'PROVIDER_MODIFIED' | 'PROVIDER_REMOVED';

export interface PlannedFlag {
  id: string;
  reason: ReviewReason;
  /** New provider values for a modification; null for a removal. */
  change: { date: string; description: string; amount: string } | null;
}

export interface SyncStats {
  added: number;
  updated: number;
  deleted: number;
  flagged: number;
  skippedPending: number;
  skippedUnknownAccount: number;
}

export interface SyncPlan {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  deletes: string[];
  flags: PlannedFlag[];
  stats: SyncStats;
}

export function isPosted(status: RowStatus): boolean {
  return status === 'CATEGORIZED' || status === 'MATCHED';
}

type State =
  | { kind: 'new'; linkId: string; txn: ExternalTransaction }
  | { kind: 'gone' }
  | { kind: 'existing'; row: ExistingRow; op: 'none' }
  | { kind: 'existing'; row: ExistingRow; op: 'update'; txn: ExternalTransaction }
  | { kind: 'existing'; row: ExistingRow; op: 'delete' }
  | { kind: 'existing'; row: ExistingRow; op: 'flag'; flag: PlannedFlag };

export const rowKey = (linkId: string, externalId: string) => `${linkId}\u0000${externalId}`;

export function planSync(input: {
  /** Provider account id → our BankAccountLink id (imported accounts only). */
  links: Map<string, string>;
  /** Existing rows keyed by rowKey(linkId, externalId). */
  existing: Map<string, ExistingRow>;
  pages: SyncPage[];
}): SyncPlan {
  const state = new Map<string, State>();
  let skippedPending = 0;
  let skippedUnknownAccount = 0;

  const current = (key: string): State | undefined => {
    const s = state.get(key);
    if (s) return s;
    const row = input.existing.get(key);
    return row ? { kind: 'existing', row, op: 'none' } : undefined;
  };

  const resolve = (externalAccountId: string, externalId: string): string | null => {
    const linkId = input.links.get(externalAccountId);
    if (!linkId) {
      skippedUnknownAccount++;
      return null;
    }
    return rowKey(linkId, externalId);
  };

  const upsert = (t: ExternalTransaction) => {
    if (t.pending) {
      skippedPending++;
      return;
    }
    const key = resolve(t.externalAccountId, t.externalId);
    if (!key) return;
    const cur = current(key);
    if (!cur || cur.kind === 'gone' || cur.kind === 'new') {
      state.set(key, { kind: 'new', linkId: input.links.get(t.externalAccountId)!, txn: t });
      return;
    }
    const { row } = cur;
    if (isPosted(row.status)) {
      const changed = row.amount !== t.amount || row.date !== t.date;
      if (changed) {
        state.set(key, {
          kind: 'existing',
          row,
          op: 'flag',
          flag: {
            id: row.id,
            reason: 'PROVIDER_MODIFIED',
            change: { date: t.date, description: t.description, amount: t.amount.toString() },
          },
        });
      }
      return;
    }
    const same = row.amount === t.amount && row.date === t.date && row.description === t.description;
    state.set(key, same && cur.op !== 'delete' ? { kind: 'existing', row, op: 'none' } : { kind: 'existing', row, op: 'update', txn: t });
  };

  const remove = (r: RemovedTransaction) => {
    const key = resolve(r.externalAccountId, r.externalId);
    if (!key) return;
    const cur = current(key);
    if (!cur || cur.kind === 'gone') return;
    if (cur.kind === 'new') {
      state.set(key, { kind: 'gone' });
      return;
    }
    const { row } = cur;
    if (isPosted(row.status)) {
      state.set(key, { kind: 'existing', row, op: 'flag', flag: { id: row.id, reason: 'PROVIDER_REMOVED', change: null } });
    } else {
      state.set(key, { kind: 'existing', row, op: 'delete' });
    }
  };

  for (const page of input.pages) {
    // Plaid's documented application order within a page.
    page.added.forEach(upsert);
    page.modified.forEach(upsert);
    page.removed.forEach(remove);
  }

  const plan: SyncPlan = {
    inserts: [],
    updates: [],
    deletes: [],
    flags: [],
    stats: { added: 0, updated: 0, deleted: 0, flagged: 0, skippedPending, skippedUnknownAccount },
  };
  for (const s of state.values()) {
    if (s.kind === 'new') plan.inserts.push({ linkId: s.linkId, txn: s.txn });
    else if (s.kind === 'existing' && s.op === 'update') plan.updates.push({ id: s.row.id, txn: s.txn });
    else if (s.kind === 'existing' && s.op === 'delete') plan.deletes.push(s.row.id);
    else if (s.kind === 'existing' && s.op === 'flag') plan.flags.push(s.flag);
  }
  plan.stats.added = plan.inserts.length;
  plan.stats.updated = plan.updates.length;
  plan.stats.deleted = plan.deletes.length;
  plan.stats.flagged = plan.flags.length;
  return plan;
}
