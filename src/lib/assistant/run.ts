// One turn of the chat assistant (Claude API, tool use, manual loop) and the
// Approve / Dismiss handling for proposed changes.
//
// Model: claude-opus-5-5 (server-side refusal fallback enabled). The history
// stored and sent is append-only and already aliased; the display is
// de-aliased per request. Needs ANTHROPIC_API_KEY.
import { randomBytes } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { categorizeTransaction, excludeTransaction } from '@/lib/banking/categorize';
import { closeMonth } from '@/lib/months';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { buildAliasMap, type AliasMap } from './aliases';
import { runTool, ToolError, TOOLS, type ProposedAction } from './tools';

export const ASSISTANT_MODEL = 'claude-opus-5-5';
const MAX_STEPS = 10;

type Message = Anthropic.Beta.BetaMessageParam;

/** The slice of the SDK we use — lets tests pass a fake. */
export interface ModelClient {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
}

export function anthropicModelClient(apiKey = process.env.ANTHROPIC_API_KEY): ModelClient | null {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  return { create: (params) => client.beta.messages.create(params) };
}

const SYSTEM = `You are the bookkeeping assistant inside "Your Tax Solution Books", used by a tax and bookkeeping office that keeps month-to-month books for small-business clients.

Privacy: clients appear only as "Client A", "Client B", …; contractors as "Client A Contractor 1", …; transaction text has person names and account numbers masked. Never ask for or guess real names, account numbers or tax IDs; refer to clients by their alias.

Use the tools to answer from the actual books. Look things up instead of guessing; say when data is missing.

You cannot change anything directly. To change the books, call a propose_* tool: the user sees an Approve button. Tell the user what you proposed and that it waits for their approval. Do not claim a proposal was carried out unless a later message says it was approved.

Bookkeeping: transfers between the client's own accounts, credit card payments, owner draws/contributions, loan principal and sales tax remittances belong on balance-sheet accounts, not income or expense. Loan payments need an interest/principal split, which the user does on the review screen — don't propose them as a single category.

Be brief and concrete: numbers, months, what's left to do.`;

export interface ChatView {
  conversationId: string;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>;
  actions: Array<Omit<ProposedAction, 'params' | 'businessId'> & { summary: string }>;
}

function textOf(content: Message['content'] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

export async function loadConversation(userId: string, conversationId?: string) {
  if (conversationId) {
    const c = await prisma.assistantConversation.findUnique({ where: { id: conversationId } });
    if (c && c.userId === userId) return c;
  }
  return prisma.assistantConversation.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
}

export function toView(c: { id: string; messages: unknown; actions: unknown }, map: AliasMap): ChatView {
  const messages = (c.messages as Message[])
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: textOf(m.content) }))
    .filter((m) => m.text.trim() && !m.text.startsWith('[status]'))
    .map((m) => ({ ...m, text: map.unmask(m.text) }));
  const actions = (c.actions as ProposedAction[]).map((a) => ({ id: a.id, type: a.type, status: a.status, result: a.result, summary: map.unmask(a.summary) }));
  return { conversationId: c.id, messages, actions };
}

/** Send one user message; run the tool loop; store everything (aliased). */
export async function chatTurn(opts: {
  userId: string;
  conversationId?: string;
  text: string;
  model?: ModelClient | null;
  fresh?: boolean;
}): Promise<ChatView> {
  const model = opts.model === undefined ? anthropicModelClient() : opts.model;
  if (!model) throw new Error('The assistant needs ANTHROPIC_API_KEY to be set on the server.');
  const map = await buildAliasMap(opts.userId);
  const existing = opts.fresh ? null : await loadConversation(opts.userId, opts.conversationId);
  const conv = existing ?? (await prisma.assistantConversation.create({ data: { userId: opts.userId } }));
  const messages = [...(conv.messages as unknown as Message[])];
  const actions = [...(conv.actions as unknown as ProposedAction[])];

  // Tell the model what happened to earlier proposals since its last turn.
  const decided = actions.filter((a) => a.status !== 'proposed' && !(a as ProposedAction & { told?: boolean }).told);
  const notes = decided.map((a) => `[status] Proposal ${a.id} was ${a.status}${a.result ? `: ${a.result}` : ''}.`);
  decided.forEach((a) => ((a as ProposedAction & { told?: boolean }).told = true));

  const userText = map.mask(opts.text.slice(0, 4000));
  messages.push({ role: 'user', content: [...notes.map((n) => ({ type: 'text' as const, text: n })), { type: 'text', text: userText }] });

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await model.create({
      model: ASSISTANT_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    // Append the assistant turn exactly as returned (thinking blocks included).
    messages.push({ role: 'assistant', content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    if (response.stop_reason === 'refusal') break;
    if (response.stop_reason === 'pause_turn') continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      try {
        const r = await runTool(use.name, (use.input ?? {}) as Record<string, unknown>, {
          userId: opts.userId,
          map,
          newActionId: () => `A${actions.length + 1}-${randomBytes(3).toString('hex')}`,
        });
        if (r.proposal) actions.push(r.proposal);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: r.text });
      } catch (err) {
        const msg = err instanceof ToolError || err instanceof LedgerValidationError ? err.message : 'That lookup failed.';
        results.push({ type: 'tool_result', tool_use_id: use.id, content: msg, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  const saved = await prisma.assistantConversation.update({
    where: { id: conv.id },
    data: { messages: messages as unknown as object, actions: actions as unknown as object },
  });
  return toView(saved, map);
}

/** A person approves a proposal: re-check everything, then do it. */
export async function decideAction(opts: { userId: string; conversationId: string; actionId: string; approve: boolean }): Promise<ChatView> {
  const conv = await prisma.assistantConversation.findUniqueOrThrow({ where: { id: opts.conversationId } });
  if (conv.userId !== opts.userId) throw new Error('Not your conversation.');
  const map = await buildAliasMap(opts.userId);
  const actions = conv.actions as unknown as ProposedAction[];
  const a = actions.find((x) => x.id === opts.actionId);
  if (!a || a.status !== 'proposed') throw new Error('That proposal is no longer open.');

  if (!opts.approve) {
    a.status = 'dismissed';
  } else {
    // Must still be an owner/accountant of that business right now.
    const m = await prisma.membership.findUnique({ where: { userId_businessId: { userId: opts.userId, businessId: a.businessId } } });
    if (!m || (m.role !== 'OWNER' && m.role !== 'ACCOUNTANT')) throw new Error('You no longer have access to that client.');
    try {
      a.result = await execute(a, opts.userId);
      a.status = 'approved';
    } catch (err) {
      a.status = 'failed';
      a.result = err instanceof Error ? map.mask(err.message) : 'failed';
    }
    await prisma.auditLog.create({
      data: {
        businessId: a.businessId,
        userId: opts.userId,
        action: 'assistant.action_approved',
        entityType: 'assistant_action',
        entityId: a.id,
        payload: { type: a.type, status: a.status, result: a.result ?? null },
      },
    });
  }
  const saved = await prisma.assistantConversation.update({ where: { id: conv.id }, data: { actions: actions as unknown as object } });
  return toView(saved, map);
}

async function execute(a: ProposedAction, userId: string): Promise<string> {
  const p = a.params as Record<string, unknown>;
  switch (a.type) {
    case 'categorize': {
      const ids = p.ids as string[];
      const account = await prisma.account.findUniqueOrThrow({ where: { id: String(p.accountId) } });
      if (account.subtype === 'long_term_liability') throw new Error('Loan payments need an interest split — do them on the Bank accounts review screen.');
      let done = 0;
      for (const [i, id] of ids.entries()) {
        await categorizeTransaction({
          businessId: a.businessId,
          userId,
          transactionId: id,
          categoryAccountId: account.id,
          rememberPayee: i === 0 && !!p.remember,
        });
        done++;
      }
      return `${done} categorized as ${account.code} ${account.name}`;
    }
    case 'exclude': {
      for (const id of p.ids as string[]) await excludeTransaction({ businessId: a.businessId, userId, transactionId: id });
      return `${(p.ids as string[]).length} excluded`;
    }
    case 'add_rule': {
      const rule = await prisma.categorizationRule.create({
        data: {
          businessId: a.businessId,
          pattern: String(p.pattern),
          matchType: 'CONTAINS',
          appliesTo: p.appliesTo as 'INFLOW' | 'OUTFLOW' | 'BOTH',
          accountId: String(p.accountId),
          priority: 50,
        },
      });
      await prisma.auditLog.create({
        data: { businessId: a.businessId, userId, action: 'categorization_rule.created', entityType: 'categorization_rule', entityId: rule.id, payload: { pattern: rule.pattern, viaAssistant: true } },
      });
      return 'rule created';
    }
    case 'close_month': {
      await closeMonth({ businessId: a.businessId, userId, month: String(p.month) });
      return `${String(p.month)} closed`;
    }
  }
}
