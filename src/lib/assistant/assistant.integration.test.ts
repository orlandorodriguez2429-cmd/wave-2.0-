// Chat assistant with a scripted stand-in for the model: what is sent never
// contains real client/contractor names or account numbers; proposals change
// nothing until approved; approval re-checks and acts; display is de-aliased.
import type Anthropic from '@anthropic-ai/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { chatTurn, decideAction, type ModelClient } from './run';
import { buildAliasMap } from './aliases';

const tag = Math.random().toString(36).slice(2, 7);
let userId: string;
let strangerId: string;
let bizA: string;
let txnZelle: string;
let txnHd: string;

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
/** Replays a script; each step decides the reply from the request. */
function scripted(steps: Array<(p: Params) => Anthropic.Beta.BetaContentBlock[]>) {
  const sent: Params[] = [];
  let i = 0;
  const model: ModelClient = {
    async create(p) {
      sent.push(JSON.parse(JSON.stringify(p)));
      const content = steps[Math.min(i++, steps.length - 1)](p);
      const stop = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
      return { id: `msg_${i}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Beta.BetaMessage;
    },
  };
  return { model, sent };
}
const tool = (name: string, input: Record<string, unknown>, id = `tu_${name}`) =>
  ({ type: 'tool_use', id, name, input }) as unknown as Anthropic.Beta.BetaContentBlock;
const say = (text: string) => ({ type: 'text', text, citations: null }) as unknown as Anthropic.Beta.BetaContentBlock;
const lastToolResult = (p: Params) => {
  const last = p.messages[p.messages.length - 1];
  const block = (last.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
  return JSON.parse(String(block.content));
};

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `asst-${tag}@t.local`, name: 'Asst' } })).id;
  strangerId = (await prisma.user.create({ data: { email: `asst-x-${tag}@t.local`, name: 'X' } })).id;
  bizA = (await createBusiness({ userId, name: `Sunrise ${tag} Cleaning LLC` })).id;
  await createBusiness({ userId, name: `Other ${tag} Co` });
  const chk = (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId: bizA, code: '1010' } } })).id;
  const conn = await prisma.bankConnection.create({
    data: { businessId: bizA, provider: 'upload', institutionName: 'Chase Checking 7781', accounts: { create: { businessId: bizA, externalAccountId: 'u', name: 'Account', mask: '7781', currency: 'USD', type: 'depository', ledgerAccountId: chk } } },
    include: { accounts: true },
  });
  const link = conn.accounts[0].id;
  txnZelle = (await prisma.importedTransaction.create({ data: { businessId: bizA, bankAccountLinkId: link, externalId: 'z', date: new Date('2026-10-10'), description: 'ZELLE TO MARIA GARCIA 5521', amount: -90000n } })).id;
  txnHd = (await prisma.importedTransaction.create({ data: { businessId: bizA, bankAccountLinkId: link, externalId: 'h', date: new Date('2026-10-07'), description: `HOME DEPOT ${tag.toUpperCase()} SUNRISE ${tag} ORDER`, amount: -15402n } })).id;
  await prisma.vendor.create({ data: { businessId: bizA, name: 'Maria Garcia' } });
});
afterAll(async () => prisma.$disconnect());

describe('chat assistant', () => {
  let conversationId: string;

  it('answers with tools; nothing identifying is ever sent to the model', async () => {
    const { model, sent } = scripted([
      () => [tool('list_clients', {})],
      () => [tool('transactions', { client: 'Client A', month: '2026-10', only_to_review: true, limit: 20 })],
      (p) => {
        const rows = lastToolResult(p) as Array<{ id: string; description: string }>;
        const hd = rows.find((r) => r.description.startsWith('HOME DEPOT'))!;
        return [say('Client A has 2 to review.'), tool('propose_categorize', { client: 'Client A', transaction_ids: [hd.id], category_code: '5000', remember_payee: true })];
      },
      () => [say('I proposed putting the Home Depot purchase in Cost of Goods Sold for Client A — approve it to apply.')],
    ]);
    const view = await chatTurn({ userId, text: `What's left for Sunrise ${tag} Cleaning? Did we pay Maria Garcia?`, model, fresh: true });
    conversationId = view.conversationId;

    const wire = JSON.stringify(sent);
    const leak = wire.match(new RegExp(`.{60}(Sunrise|Maria|Garcia|7781|5521|Other ${tag}).{60}`, 'i'));
    expect(leak?.[0] ?? null).toBeNull();
    expect(wire).not.toMatch(new RegExp(`Sunrise|Maria|Garcia|7781|5521|Other ${tag}`, 'i'));
    expect(wire).toContain('Client A');
    expect(wire).toContain('Client A Contractor 1'); // "Maria Garcia" in the user's question
    expect(wire).toContain('ZELLE TO [person]');
    expect(sent[0].model).toBe('claude-opus-5-5');

    // The user sees real names again.
    expect(view.messages[0].text).toContain(`Sunrise ${tag} Cleaning LLC`);
    expect(view.messages.at(-1)!.text).toContain(`Sunrise ${tag} Cleaning LLC`);
    expect(view.actions).toHaveLength(1);
    expect(view.actions[0]).toMatchObject({ status: 'proposed', type: 'categorize' });
    expect(view.actions[0].summary).toContain(`Sunrise ${tag} Cleaning LLC`);

    // Proposing changed nothing.
    expect((await prisma.importedTransaction.findUniqueOrThrow({ where: { id: txnHd } })).status).toBe('PENDING');
  });

  it('approve applies it (with the learned rule) and is audit-logged; the model is told next turn', async () => {
    const conv = await prisma.assistantConversation.findUniqueOrThrow({ where: { id: conversationId } });
    const actionId = (conv.actions as Array<{ id: string }>)[0].id;
    await expect(decideAction({ userId: strangerId, conversationId, actionId, approve: true })).rejects.toThrow(/Not your conversation/);
    const view = await decideAction({ userId, conversationId, actionId, approve: true });
    expect(view.actions[0]).toMatchObject({ status: 'approved' });
    const t = await prisma.importedTransaction.findUniqueOrThrow({ where: { id: txnHd } });
    expect([t.status, t.categorizedBy]).toEqual(['CATEGORIZED', 'USER']);
    expect(await prisma.categorizationRule.count({ where: { businessId: bizA, source: 'LEARNED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { businessId: bizA, action: 'assistant.action_approved' } })).toBe(1);
    await expect(decideAction({ userId, conversationId, actionId, approve: true })).rejects.toThrow(/no longer open/);

    const { model, sent } = scripted([() => [say('Done.')]]);
    await chatTurn({ userId, conversationId, text: 'thanks', model });
    expect(JSON.stringify(sent[0].messages.at(-1))).toMatch(/\[status\] Proposal .* was approved: 1 categorized/);
  });

  it('bad tool input becomes an error result, not a crash; unknown clients are refused', async () => {
    const { model, sent } = scripted([
      () => [tool('propose_categorize', { client: 'Client Z', transaction_ids: [txnZelle], category_code: '6900', remember_payee: false })],
      () => [tool('propose_categorize', { client: 'Client A', transaction_ids: [txnHd], category_code: '6900', remember_payee: false }, 'tu2')],
      () => [say('Sorry.')],
    ]);
    const view = await chatTurn({ userId, conversationId, text: 'categorize the zelle', model });
    const results = sent.slice(1).map((p) => (p.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]);
    expect(results[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/Unknown client/) });
    expect(results[1]).toMatchObject({ is_error: true, content: expect.stringMatching(/already on the books/) });
    expect(view.actions).toHaveLength(1); // nothing new proposed
  });

  it('dismiss leaves the books alone; loan accounts are refused at approval', async () => {
    const { model } = scripted([
      () => [tool('propose_categorize', { client: 'Client A', transaction_ids: [txnZelle], category_code: '2500', remember_payee: false })],
      () => [say('Proposed.')],
    ]);
    let view = await chatTurn({ userId, conversationId, text: 'put the zelle on the loan', model });
    const loan = view.actions.at(-1)!;
    view = await decideAction({ userId, conversationId, actionId: loan.id, approve: true });
    expect(view.actions.at(-1)).toMatchObject({ status: 'failed', result: expect.stringMatching(/interest split/) });
    expect((await prisma.importedTransaction.findUniqueOrThrow({ where: { id: txnZelle } })).status).toBe('PENDING');
  });

  it('alias map: distinctive first words count, shared ones do not', async () => {
    const map = await buildAliasMap(userId);
    expect(map.mask(`how is sunrise doing vs other ${tag} co`)).toBe('how is Client A doing vs Client B');
    expect(map.unmask('Client A and Client B')).toBe(`Sunrise ${tag} Cleaning LLC and Other ${tag} Co`);
  });
});
