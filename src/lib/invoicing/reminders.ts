import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { getEmailProvider, type EmailProvider } from '@/lib/email/provider';

/** Don't re-remind the same invoice more often than this, even if the job runs daily. */
const MIN_DAYS_BETWEEN_REMINDERS = 3;

export interface ReminderResult {
  invoiceId: string;
  number: number;
  sent: boolean;
  reason?: string;
}

function reminderBody(opts: {
  businessName: string;
  invoiceNumber: number;
  balance: bigint;
  currency: string;
  dueDate: Date;
  daysOverdue: number;
  portalToken: string;
}): { subject: string; text: string } {
  const amount = formatMoney(opts.balance, opts.currency);
  const subject = `Payment reminder: Invoice #${opts.invoiceNumber} from ${opts.businessName} is ${opts.daysOverdue} day(s) overdue`;
  const text =
    `Invoice #${opts.invoiceNumber} for ${amount} was due on ${opts.dueDate.toISOString().slice(0, 10)} ` +
    `and is now ${opts.daysOverdue} day(s) overdue.\n\n` +
    `Pay online: /portal/${opts.portalToken}\n\n` +
    `— ${opts.businessName}`;
  return { subject, text };
}

/**
 * Send (or record, in the sandbox) an overdue-payment reminder for one
 * invoice, regardless of when the last one went out. Used by the manual
 * "Send reminder now" button — the automatic job below applies the
 * dedupe window instead.
 */
export async function sendInvoiceReminder(opts: {
  businessId: string;
  invoiceId: string;
  provider?: EmailProvider;
}): Promise<ReminderResult> {
  const provider = opts.provider ?? getEmailProvider();
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: opts.invoiceId },
    include: { customer: true, payments: true, business: true },
  });
  if (invoice.businessId !== opts.businessId) throw new Error('Wrong business.');
  if (invoice.status !== 'OPEN') {
    return { invoiceId: invoice.id, number: invoice.number, sent: false, reason: 'Invoice is not open.' };
  }
  if (!invoice.customer.email) {
    return { invoiceId: invoice.id, number: invoice.number, sent: false, reason: 'Customer has no email on file.' };
  }
  const balance = invoice.total - invoice.payments.reduce((s, p) => s + p.amount, 0n);
  if (balance <= 0n) {
    return { invoiceId: invoice.id, number: invoice.number, sent: false, reason: 'Nothing outstanding.' };
  }

  const today = new Date();
  const daysOverdue = Math.max(0, Math.floor((today.getTime() - invoice.dueDate.getTime()) / 86400_000));
  const { subject, text } = reminderBody({
    businessName: invoice.business.name,
    invoiceNumber: invoice.number,
    balance,
    currency: invoice.currency,
    dueDate: invoice.dueDate,
    daysOverdue,
    portalToken: invoice.portalToken,
  });

  const result = await provider.send({ to: invoice.customer.email, subject, text });
  await prisma.emailMessage.create({
    data: {
      businessId: invoice.businessId,
      toEmail: invoice.customer.email,
      subject,
      bodyText: text,
      kind: 'INVOICE_REMINDER',
      relatedInvoiceId: invoice.id,
      providerName: provider.name,
      providerMessageId: result.providerMessageId,
    },
  });
  return { invoiceId: invoice.id, number: invoice.number, sent: true };
}

/**
 * Automatic pass: every open, overdue invoice across every business gets a
 * reminder, skipping any invoice reminded within the last
 * MIN_DAYS_BETWEEN_REMINDERS days. Called by the jobs runner
 * (scripts/run-jobs.ts) — cron/queue infrastructure plugs in on top.
 */
export async function sendDueReminders(asOf: Date = new Date()): Promise<ReminderResult[]> {
  const provider = getEmailProvider();
  const overdue = await prisma.invoice.findMany({
    where: { status: 'OPEN', dueDate: { lt: asOf } },
    include: { customer: true, payments: true, business: true },
  });

  const results: ReminderResult[] = [];
  for (const invoice of overdue) {
    const balance = invoice.total - invoice.payments.reduce((s, p) => s + p.amount, 0n);
    if (balance <= 0n) continue;
    if (!invoice.customer.email) {
      results.push({ invoiceId: invoice.id, number: invoice.number, sent: false, reason: 'Customer has no email on file.' });
      continue;
    }

    const lastReminder = await prisma.emailMessage.findFirst({
      where: { relatedInvoiceId: invoice.id, kind: 'INVOICE_REMINDER' },
      orderBy: { sentAt: 'desc' },
    });
    if (lastReminder) {
      const daysSince = (asOf.getTime() - lastReminder.sentAt.getTime()) / 86400_000;
      if (daysSince < MIN_DAYS_BETWEEN_REMINDERS) {
        results.push({ invoiceId: invoice.id, number: invoice.number, sent: false, reason: 'Reminded recently.' });
        continue;
      }
    }

    const daysOverdue = Math.max(0, Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86400_000));
    const { subject, text } = reminderBody({
      businessName: invoice.business.name,
      invoiceNumber: invoice.number,
      balance,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      daysOverdue,
      portalToken: invoice.portalToken,
    });
    const sendResult = await provider.send({ to: invoice.customer.email, subject, text });
    await prisma.emailMessage.create({
      data: {
        businessId: invoice.businessId,
        toEmail: invoice.customer.email,
        subject,
        bodyText: text,
        kind: 'INVOICE_REMINDER',
        relatedInvoiceId: invoice.id,
        providerName: provider.name,
        providerMessageId: sendResult.providerMessageId,
      },
    });
    results.push({ invoiceId: invoice.id, number: invoice.number, sent: true });
  }
  return results;
}
