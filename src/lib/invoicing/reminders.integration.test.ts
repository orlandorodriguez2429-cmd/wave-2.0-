// Reminder delivery against a real Postgres, using a fake EmailProvider so
// tests assert on what was "sent" without depending on console output.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { approveInvoice, createDraftInvoice, recordPayment } from './invoices';
import { sendDueReminders, sendInvoiceReminder } from './reminders';
import type { EmailProvider, OutboundEmail, SendResult } from '@/lib/email/provider';

class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  sent: OutboundEmail[] = [];
  async send(email: OutboundEmail): Promise<SendResult> {
    this.sent.push(email);
    return { providerMessageId: `FAKE-${this.sent.length}` };
  }
}

let userId: string;
let businessId: string;
let customerId: string;
let noEmailCustomerId: string;
let checking: string;
let serviceRevenue: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `rem-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Reminder Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Reminders Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, serviceRevenue] = await Promise.all(['1010', '4100'].map(byCode));
  customerId = (await prisma.customer.create({ data: { businessId, name: 'Overdue Customer', email: 'billing@overdue.test' } })).id;
  noEmailCustomerId = (await prisma.customer.create({ data: { businessId, name: 'No Email Customer' } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function openInvoice(customerIdArg: string, dueDate: Date) {
  const draft = await createDraftInvoice({
    businessId,
    userId,
    input: {
      customerId: customerIdArg,
      issueDate: new Date('2026-01-01'),
      dueDate,
      currency: 'USD',
      exchangeRate: '1',
      lines: [{ description: 'Consulting', quantityMilli: 1000n, unitPrice: 50000n, incomeAccountId: serviceRevenue }],
    },
  });
  return approveInvoice({ businessId, userId, invoiceId: draft.id });
}

describe('invoice reminders', () => {
  it('sendInvoiceReminder records an EmailMessage and returns sent:true for an open invoice with an email', async () => {
    const invoice = await openInvoice(customerId, new Date('2026-01-01'));
    const provider = new FakeEmailProvider();
    const result = await sendInvoiceReminder({ businessId, invoiceId: invoice.id, provider });

    expect(result.sent).toBe(true);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].to).toBe('billing@overdue.test');

    const rows = await prisma.emailMessage.findMany({ where: { relatedInvoiceId: invoice.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('INVOICE_REMINDER');
    expect(rows[0].providerName).toBe('fake');
  });

  it('refuses to send when the customer has no email on file', async () => {
    const invoice = await openInvoice(noEmailCustomerId, new Date('2026-01-01'));
    const provider = new FakeEmailProvider();
    const result = await sendInvoiceReminder({ businessId, invoiceId: invoice.id, provider });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/no email/i);
    expect(provider.sent).toHaveLength(0);
  });

  it('refuses to send once the invoice is fully paid', async () => {
    const invoice = await openInvoice(customerId, new Date('2026-01-01'));
    await recordPayment({
      businessId,
      userId,
      invoiceId: invoice.id,
      date: new Date('2026-01-05'),
      amount: 50000n,
      method: 'ACH',
      depositAccountId: checking,
    });
    const provider = new FakeEmailProvider();
    const result = await sendInvoiceReminder({ businessId, invoiceId: invoice.id, provider });
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/not open/i);
  });

  it('sendDueReminders only reminds open, overdue, unpaid invoices with an email, and dedupes recent sends', async () => {
    const overdue = await openInvoice(customerId, new Date('2025-01-01'));
    const notYetDue = await openInvoice(customerId, new Date('2099-01-01'));

    const first = await sendDueReminders(new Date('2026-06-01'));
    const overdueResult = first.find((r) => r.invoiceId === overdue.id);
    expect(overdueResult?.sent).toBe(true);
    expect(first.some((r) => r.invoiceId === notYetDue.id)).toBe(false);

    // Running again the same day must not double-send (dedupe window).
    const second = await sendDueReminders(new Date('2026-06-01'));
    const overdueResultAgain = second.find((r) => r.invoiceId === overdue.id);
    expect(overdueResultAgain?.sent).toBe(false);

    const count = await prisma.emailMessage.count({ where: { relatedInvoiceId: overdue.id } });
    expect(count).toBe(1);
  });
});
