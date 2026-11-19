import { prisma } from '@/lib/db';
import { systemAccount } from '@/lib/ledger/accounts';
import { createAndPostEntry } from '@/lib/ledger/post';
import { LedgerValidationError } from '@/lib/ledger/validate';

// Late fees are opt-in per business (Business.lateFeePercentagePpm, null =
// disabled), a percentage of the outstanding balance (parts-per-million,
// same convention as TaxRate.ratePpm), assessed once per invoice — not
// compounding — after Business.lateFeeGraceDays past the due date.
//
// Applying one posts Dr Accounts Receivable / Cr Late Fee Income and bumps
// invoice.total, so the existing balance/payment logic needs no changes.

export interface LateFeeEligibility {
  eligible: boolean;
  reason?: string;
  feeAmount?: bigint;
}

export async function checkLateFeeEligibility(opts: {
  businessId: string;
  invoiceId: string;
  asOf?: Date;
}): Promise<LateFeeEligibility> {
  const asOf = opts.asOf ?? new Date();
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  if (!business.lateFeePercentagePpm) {
    return { eligible: false, reason: 'Late fees are not enabled for this business.' };
  }
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: opts.invoiceId },
    include: { payments: true, lateFeeCharges: true },
  });
  if (invoice.businessId !== opts.businessId) throw new LedgerValidationError('Wrong business.');
  if (invoice.status !== 'OPEN') return { eligible: false, reason: 'Invoice is not open.' };
  if (invoice.lateFeeCharges.length > 0) {
    return { eligible: false, reason: 'A late fee has already been applied to this invoice.' };
  }
  const daysOverdue = Math.floor((asOf.getTime() - invoice.dueDate.getTime()) / 86400_000);
  if (daysOverdue < business.lateFeeGraceDays) {
    return { eligible: false, reason: `Not yet overdue past the ${business.lateFeeGraceDays}-day grace period.` };
  }
  const balance = invoice.total - invoice.payments.reduce((s, p) => s + p.amount, 0n);
  if (balance <= 0n) return { eligible: false, reason: 'Nothing outstanding.' };

  const feeAmount = (balance * BigInt(business.lateFeePercentagePpm) + 500_000n) / 1_000_000n; // half-up
  if (feeAmount <= 0n) return { eligible: false, reason: 'Computed fee rounds to zero.' };
  return { eligible: true, feeAmount };
}

/** Apply the one-time late fee to an eligible invoice. Throws if not eligible. */
export async function applyLateFee(opts: {
  businessId: string;
  userId: string;
  invoiceId: string;
  asOf?: Date;
}) {
  const asOf = opts.asOf ?? new Date();
  const eligibility = await checkLateFeeEligibility({ ...opts, asOf });
  if (!eligibility.eligible || !eligibility.feeAmount) {
    throw new LedgerValidationError(eligibility.reason ?? 'Not eligible for a late fee.');
  }

  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: opts.invoiceId } });
  const ar = await systemAccount(prisma, opts.businessId, 'accounts_receivable');
  const lateFeeIncome = await systemAccount(prisma, opts.businessId, 'late_fee_income');

  const entry = await createAndPostEntry({
    businessId: opts.businessId,
    userId: opts.userId,
    source: 'LATE_FEE',
    input: {
      date: asOf,
      memo: `Late fee — invoice #${invoice.number}`,
      currency: invoice.currency,
      exchangeRate: invoice.exchangeRate.toString(),
      lines: [
        { accountId: ar.id, direction: 'DEBIT', amount: eligibility.feeAmount, description: `Invoice #${invoice.number}` },
        { accountId: lateFeeIncome.id, direction: 'CREDIT', amount: eligibility.feeAmount },
      ],
    },
  });

  const [charge] = await prisma.$transaction([
    prisma.lateFeeCharge.create({
      data: {
        businessId: opts.businessId,
        invoiceId: invoice.id,
        amount: eligibility.feeAmount,
        journalEntryId: entry.id,
        appliedAt: asOf,
      },
    }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { total: { increment: eligibility.feeAmount } },
    }),
  ]);

  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'invoice.late_fee_applied',
      entityType: 'invoice',
      entityId: invoice.id,
      payload: { number: invoice.number, amount: eligibility.feeAmount.toString(), journalEntryId: entry.id },
    },
  });
  return charge;
}
