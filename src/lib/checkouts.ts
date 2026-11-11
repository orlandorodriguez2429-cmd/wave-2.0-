import { prisma } from '@/lib/db';
import { createAndPostEntry, reverseEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';

// Checkouts: standalone payment-collection links, not tied to an invoice —
// the "request $50 for a workshop seat" case Wave calls Checkouts. Paying one
// posts Dr deposit account / Cr income account directly, same engine as
// everything else. Sandboxed the same way invoice payments are: a "Pay now"
// click simulates a successful card charge, no real processor involved.

export interface CheckoutInput {
  description: string;
  amount: bigint;
  currency: string;
  incomeAccountId: string;
}

export async function createCheckout(opts: { businessId: string; userId: string; input: CheckoutInput }) {
  const { businessId, userId, input } = opts;
  if (input.amount <= 0n) throw new LedgerValidationError('Amount must be positive.');
  if (!input.description.trim()) throw new LedgerValidationError('A description is required.');

  const checkout = await prisma.checkout.create({
    data: {
      businessId,
      description: input.description.trim(),
      amount: input.amount,
      currency: input.currency,
      incomeAccountId: input.incomeAccountId,
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId,
      userId,
      action: 'checkout.created',
      entityType: 'checkout',
      entityId: checkout.id,
      payload: { description: checkout.description, amount: checkout.amount.toString() },
    },
  });
  return checkout;
}

/**
 * Simulate a successful sandbox payment against an open checkout link. No
 * login on this path (public token URL, like the invoice portal) — the
 * posted entry attributes to the business owner, same convention as
 * `portalPayAction` for invoice portal payments.
 */
export async function payCheckout(opts: { token: string; payerName?: string }) {
  const checkout = await prisma.checkout.findUnique({ where: { token: opts.token } });
  if (!checkout) throw new LedgerValidationError('Checkout link not found.');
  if (checkout.status !== 'OPEN') throw new LedgerValidationError('This checkout has already been paid or was voided.');

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: checkout.businessId },
    include: { memberships: { where: { role: 'OWNER' }, take: 1 } },
  });
  const deposit = await prisma.account.findFirst({
    where: { businessId: checkout.businessId, subtype: 'cash_and_bank', isArchived: false },
    orderBy: { code: 'asc' },
  });
  const ownerId = business.memberships[0]?.userId;
  if (!deposit || !ownerId) throw new LedgerValidationError('This business has no bank account or owner set up yet.');

  const entry = await createAndPostEntry({
    businessId: checkout.businessId,
    userId: ownerId,
    source: 'CHECKOUT',
    input: {
      date: new Date(),
      memo: `Checkout — ${checkout.description}`,
      currency: checkout.currency,
      exchangeRate: '1',
      lines: [
        { accountId: deposit.id, direction: 'DEBIT', amount: checkout.amount },
        { accountId: checkout.incomeAccountId, direction: 'CREDIT', amount: checkout.amount, description: checkout.description },
      ],
    },
  });

  return prisma.checkout.update({
    where: { id: checkout.id },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      depositAccountId: deposit.id,
      payerName: opts.payerName?.trim() || null,
      journalEntryId: entry.id,
    },
  });
}

export async function voidCheckout(opts: { businessId: string; userId: string; checkoutId: string }) {
  const checkout = await prisma.checkout.findUniqueOrThrow({ where: { id: opts.checkoutId } });
  if (checkout.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (checkout.status === 'VOID') return checkout;
  if (checkout.status === 'PAID' && checkout.journalEntryId) {
    await reverseEntry({
      businessId: opts.businessId,
      userId: opts.userId,
      entryId: checkout.journalEntryId,
      memo: `Void checkout — ${checkout.description}`,
    });
  }
  const updated = await prisma.checkout.update({ where: { id: checkout.id }, data: { status: 'VOID' } });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'checkout.voided',
      entityType: 'checkout',
      entityId: checkout.id,
      payload: { description: checkout.description },
    },
  });
  return updated;
}
