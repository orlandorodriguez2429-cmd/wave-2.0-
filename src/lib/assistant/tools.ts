// Tools the chat assistant can use. READ tools answer from the books.
// ACTION tools never change anything: they record a proposal that a person
// approves (or dismisses) in the chat. Every result passes through the alias
// map, so clients and people are "Client A" / "Client A Contractor 1".
import type Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { formatAmount } from '@/lib/money';
import { firmOverview } from '@/lib/firm';
import { monthStatuses } from '@/lib/months';
import { portalPnl } from '@/lib/client-portal';
import { vendor1099Totals } from '@/lib/forms1099/tracking';
import { cleanDescription } from '@/lib/banking/ai-categorize';
import type { AliasMap } from './aliases';

export interface ProposedAction {
  id: string;
  type: 'categorize' | 'exclude' | 'add_rule' | 'close_month';
  businessId: string;
  params: Record<string, unknown>;
  /** Aliased summary, as the model and the history see it. */
  summary: string;
  status: 'proposed' | 'approved' | 'dismissed' | 'failed';
  result?: string;
}

const obj = (properties: Record<string, unknown>, required: string[]) =>
  ({ type: 'object' as const, properties, required, additionalProperties: false });
const client = { type: 'string', description: 'Client alias exactly as given by list_clients, e.g. "Client A".' };
const month = { type: 'string', description: 'Month as YYYY-MM.' };

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'list_clients', description: 'All clients with bank status, items waiting for review, months not closed and 1099 issues. Start here.', input_schema: obj({}, []), strict: true },
  { name: 'client_months', description: "One client's month-by-month status (closed, ready, N to review, no data).", input_schema: obj({ client }, ['client']), strict: true },
  {
    name: 'profit_and_loss',
    description: "One client's Profit & Loss for a date range (on the client's own cash/accrual basis).",
    input_schema: obj({ client, from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, ['client', 'from', 'to']),
    strict: true,
  },
  {
    name: 'transactions',
    description: "One client's bank transactions. Use only_to_review for the review queue. Returns ids needed for proposals.",
    input_schema: obj(
      { client, month: { type: ['string', 'null'], description: 'YYYY-MM or null for all' }, only_to_review: { type: 'boolean' }, limit: { type: 'integer', description: '1-100' } },
      ['client', 'month', 'only_to_review', 'limit'],
    ),
    strict: true,
  },
  { name: 'categories', description: "One client's chart of accounts (code, name, type) — the codes to use in proposals.", input_schema: obj({ client }, ['client']), strict: true },
  {
    name: 'contractors_1099',
    description: "One client's contractor payments for a tax year, with 1099 status and whether a W-9 is on file.",
    input_schema: obj({ client, year: { type: 'integer' } }, ['client', 'year']),
    strict: true,
  },
  {
    name: 'propose_categorize',
    description: 'PROPOSE putting pending transactions in a category. Nothing changes until the user clicks Approve.',
    input_schema: obj(
      {
        client,
        transaction_ids: { type: 'array', items: { type: 'string' } },
        category_code: { type: 'string' },
        remember_payee: { type: 'boolean', description: 'Also create a rule so this payee is sorted automatically next time.' },
      },
      ['client', 'transaction_ids', 'category_code', 'remember_payee'],
    ),
    strict: true,
  },
  {
    name: 'propose_exclude',
    description: 'PROPOSE keeping pending transactions off the books (duplicates, personal). Needs Approve.',
    input_schema: obj({ client, transaction_ids: { type: 'array', items: { type: 'string' } } }, ['client', 'transaction_ids']),
    strict: true,
  },
  {
    name: 'propose_rule',
    description: 'PROPOSE a rule: bank descriptions containing some text go to a category automatically. Needs Approve.',
    input_schema: obj(
      { client, contains_text: { type: 'string' }, category_code: { type: 'string' }, direction: { type: 'string', enum: ['money_in', 'money_out', 'both'] } },
      ['client', 'contains_text', 'category_code', 'direction'],
    ),
    strict: true,
  },
  { name: 'propose_close_month', description: 'PROPOSE closing a month (locks it). Needs Approve.', input_schema: obj({ client, month }, ['client', 'month']), strict: true },
];

export class ToolError extends Error {}

const money = (v: bigint) => formatAmount(v, 'USD');

async function businessFor(map: AliasMap, alias: unknown): Promise<string> {
  const id = typeof alias === 'string' ? map.businessIdOf(alias) : null;
  if (!id) throw new ToolError(`Unknown client "${String(alias)}". Use an alias from list_clients.`);
  return id;
}

async function pendingRows(businessId: string, ids: unknown) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw new ToolError('Give 1–200 transaction ids.');
  const rows = await prisma.importedTransaction.findMany({ where: { id: { in: ids.map(String) }, businessId } });
  if (rows.length !== ids.length) throw new ToolError('Some transaction ids are not this client’s.');
  const notPending = rows.filter((r) => r.status !== 'PENDING');
  if (notPending.length) throw new ToolError(`${notPending.length} of those are already on the books.`);
  return rows;
}

async function accountByCode(businessId: string, code: unknown) {
  const a = await prisma.account.findFirst({ where: { businessId, code: String(code), isArchived: false } });
  if (!a) throw new ToolError(`No category with code ${String(code)} for this client. Use the categories tool.`);
  return a;
}

/**
 * Run one tool. Returns the JSON text for the model (aliased) and, for
 * action tools, the proposal to store.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { userId: string; map: AliasMap; newActionId: () => string },
): Promise<{ text: string; proposal?: ProposedAction }> {
  const { map } = ctx;
  const out = (v: unknown) => ({ text: map.mask(JSON.stringify(v)) });

  switch (name) {
    case 'list_clients': {
      const rows = await firmOverview(ctx.userId);
      return out(
        rows.map((r) => ({
          client: map.aliasOfBusiness(r.businessId),
          bank: r.bank.toLowerCase(),
          last_sync: r.lastSyncAt?.toISOString().slice(0, 10) ?? null,
          to_review: r.toReview,
          months_not_closed: r.monthsNotClosed,
          oldest_open_month: r.oldestOpenMonth,
          need_1099: r.needs1099,
          missing_w9: r.missingW9,
        })),
      );
    }
    case 'client_months': {
      const id = await businessFor(map, input.client);
      const rows = await monthStatuses(id);
      return out(rows.map((m) => ({ month: m.key, status: m.status.toLowerCase(), bank_transactions: m.imported, to_review: m.toReview + m.flagged })));
    }
    case 'profit_and_loss': {
      const id = await businessFor(map, input.client);
      const from = new Date(String(input.from));
      const to = new Date(String(input.to));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ToolError('Dates must be YYYY-MM-DD.');
      const p = await portalPnl(id, from, to);
      const section = (s: typeof p.income) => ({ total: money(s.total), lines: s.rows.map((r) => ({ code: r.code, account: r.name, amount: money(r.amount) })) });
      return out({ from: input.from, to: input.to, income: section(p.income), cost_of_goods_sold: section(p.cogs), expenses: section(p.expenses), net_income: money(p.netIncome) });
    }
    case 'transactions': {
      const id = await businessFor(map, input.client);
      const limit = Math.max(1, Math.min(100, Number(input.limit) || 50));
      const where: Record<string, unknown> = { businessId: id };
      if (typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month)) {
        const [y, m] = input.month.split('-').map(Number);
        where.date = { gte: new Date(Date.UTC(y, m - 1, 1)), lte: new Date(Date.UTC(y, m, 0)) };
      }
      if (input.only_to_review) where.status = 'PENDING';
      const rows = await prisma.importedTransaction.findMany({
        where,
        orderBy: { date: 'desc' },
        take: limit,
        include: { bankAccountLink: { select: { type: true, ledgerAccountId: true } } },
      });
      const entryIds = rows.map((r) => r.journalEntryId).filter((x): x is string => !!x);
      const lines = entryIds.length ? await prisma.journalLine.findMany({ where: { entryId: { in: entryIds } }, include: { account: true } }) : [];
      const suggested = await prisma.account.findMany({ where: { id: { in: rows.map((r) => r.suggestedAccountId).filter((x): x is string => !!x) } } });
      return out(
        rows.map((r) => {
          const cat = lines.filter((l) => l.entryId === r.journalEntryId && l.accountId !== r.bankAccountLink.ledgerAccountId).map((l) => `${l.account.code} ${l.account.name}`);
          const sug = suggested.find((a) => a.id === r.suggestedAccountId);
          return {
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            description: cleanDescription(r.description, r.merchantName),
            amount: money(r.amount),
            account: r.bankAccountLink.type === 'credit' ? 'credit card' : 'bank account',
            status: r.status.toLowerCase(),
            category: cat.join(' + ') || null,
            decided_by: r.categorizedBy?.toLowerCase() ?? null,
            suggestion: sug ? `${sug.code} ${sug.name}` : null,
            suggestion_reason: r.aiReason,
          };
        }),
      );
    }
    case 'categories': {
      const id = await businessFor(map, input.client);
      const accts = await prisma.account.findMany({ where: { businessId: id, isArchived: false }, orderBy: { code: 'asc' } });
      return out(accts.map((a) => ({ code: a.code, name: a.name, type: a.type.toLowerCase() })));
    }
    case 'contractors_1099': {
      const id = await businessFor(map, input.client);
      const totals = await vendor1099Totals(id, Number(input.year) || new Date().getUTCFullYear());
      return out(totals.map((t) => ({ contractor: map.aliasOfVendor(t.vendorId), reportable: money(t.reportableTotal), status: t.status.toLowerCase(), w9_on_file: t.is1099Eligible })));
    }

    // --- proposals (nothing changes here) ---------------------------------------
    case 'propose_categorize': {
      const id = await businessFor(map, input.client);
      const rows = await pendingRows(id, input.transaction_ids);
      const acct = await accountByCode(id, input.category_code);
      const summary = `${map.aliasOfBusiness(id)}: put ${rows.length} transaction(s) in ${acct.code} ${acct.name}${input.remember_payee ? ' and remember the payee' : ''} (${rows.slice(0, 3).map((r) => cleanDescription(r.description, r.merchantName)).join('; ')}${rows.length > 3 ? '; …' : ''})`;
      return proposal(ctx, { type: 'categorize', businessId: id, params: { ids: rows.map((r) => r.id), accountId: acct.id, remember: !!input.remember_payee }, summary });
    }
    case 'propose_exclude': {
      const id = await businessFor(map, input.client);
      const rows = await pendingRows(id, input.transaction_ids);
      return proposal(ctx, { type: 'exclude', businessId: id, params: { ids: rows.map((r) => r.id) }, summary: `${map.aliasOfBusiness(id)}: keep ${rows.length} transaction(s) off the books` });
    }
    case 'propose_rule': {
      const id = await businessFor(map, input.client);
      const text = String(input.contains_text ?? '').trim();
      if (text.length < 3) throw new ToolError('Rule text must be at least 3 characters.');
      const acct = await accountByCode(id, input.category_code);
      const dir = input.direction === 'money_in' ? 'INFLOW' : input.direction === 'money_out' ? 'OUTFLOW' : 'BOTH';
      return proposal(ctx, {
        type: 'add_rule',
        businessId: id,
        params: { pattern: text, accountId: acct.id, appliesTo: dir },
        summary: `${map.aliasOfBusiness(id)}: rule — descriptions containing "${map.mask(text)}" → ${acct.code} ${acct.name}`,
      });
    }
    case 'propose_close_month': {
      const id = await businessFor(map, input.client);
      const m = String(input.month ?? '');
      if (!/^\d{4}-\d{2}$/.test(m)) throw new ToolError('Month must be YYYY-MM.');
      return proposal(ctx, { type: 'close_month', businessId: id, params: { month: m }, summary: `${map.aliasOfBusiness(id)}: close ${m}` });
    }
    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

function proposal(ctx: { map: AliasMap; newActionId: () => string }, p: Omit<ProposedAction, 'id' | 'status'>) {
  // Summaries quote bank text, which can contain a client's own name: mask it.
  const action: ProposedAction = { ...p, summary: ctx.map.mask(p.summary), id: ctx.newActionId(), status: 'proposed' };
  return {
    text: ctx.map.mask(JSON.stringify({ status: 'proposed — waiting for the user to click Approve', action_id: action.id, summary: action.summary })),
    proposal: action,
  };
}
