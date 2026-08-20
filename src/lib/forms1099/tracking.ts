import { prisma } from '@/lib/db';
import type { PaymentMethod, VendorPaymentSource } from '@/generated/prisma/enums';
import { BOX_BY_CODE } from './boxes';
import { getTaxYearConfig, thresholdFor } from './thresholds';

/**
 * Payment methods excluded from payer-side 1099 reporting: card and
 * third-party network payments are the processor's 1099-K, not ours.
 * This exclusion is the compliance-critical rule — see PROJECT.md.
 */
export function isExcludedMethod(method: PaymentMethod): boolean {
  return method === 'CARD';
}

export async function recordVendorPayment(opts: {
  businessId: string;
  userId: string;
  vendorId: string;
  date: Date;
  /** Functional-currency minor units, positive. */
  amount: bigint;
  method: PaymentMethod;
  boxCode?: string;
  source?: VendorPaymentSource;
  expenseId?: string;
  memo?: string;
}) {
  if (opts.amount <= 0n) throw new Error('Vendor payment amount must be positive.');
  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: opts.vendorId } });
  if (vendor.businessId !== opts.businessId) throw new Error('Wrong business.');
  const boxCode = opts.boxCode ?? vendor.defaultBoxCode;
  if (!BOX_BY_CODE.has(boxCode)) throw new Error(`Unknown 1099 box code: ${boxCode}`);

  const payment = await prisma.vendorPayment.create({
    data: {
      businessId: opts.businessId,
      vendorId: opts.vendorId,
      date: opts.date,
      amount: opts.amount,
      method: opts.method,
      boxCode,
      source: opts.source ?? 'MANUAL',
      expenseId: opts.expenseId,
      memo: opts.memo?.trim() || null,
      excludedFrom1099: isExcludedMethod(opts.method),
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'vendor_payment.recorded',
      entityType: 'vendor_payment',
      entityId: payment.id,
      payload: {
        vendorId: opts.vendorId,
        amount: opts.amount.toString(),
        method: opts.method,
        boxCode,
        excludedFrom1099: payment.excludedFrom1099,
      },
    },
  });
  return payment;
}

export type ThresholdStatus = 'BELOW' | 'APPROACHING' | 'REPORTABLE';

export interface VendorYearTotals {
  vendorId: string;
  vendorName: string;
  w9Status: string;
  is1099Eligible: boolean;
  /** Reportable totals per box code (card payments excluded). */
  byBox: Record<string, bigint>;
  reportableTotal: bigint;
  /** Card/third-party payments — shown so the exclusion is visible, never silent. */
  excludedTotal: bigint;
  /** Highest status across boxes. */
  status: ThresholdStatus;
}

/** APPROACHING kicks in at 80% of the box's threshold. */
const APPROACHING_NUM = 80n;
const APPROACHING_DEN = 100n;

export async function vendor1099Totals(businessId: string, taxYear: number): Promise<VendorYearTotals[]> {
  const config = await getTaxYearConfig(taxYear);
  const from = new Date(Date.UTC(taxYear, 0, 1));
  const to = new Date(Date.UTC(taxYear, 11, 31));

  const payments = await prisma.vendorPayment.findMany({
    where: { businessId, date: { gte: from, lte: to } },
    include: { vendor: true },
  });

  const byVendor = new Map<string, VendorYearTotals>();
  for (const p of payments) {
    let v = byVendor.get(p.vendorId);
    if (!v) {
      v = {
        vendorId: p.vendorId,
        vendorName: p.vendor.name,
        w9Status: p.vendor.w9Status,
        is1099Eligible: p.vendor.is1099Eligible,
        byBox: {},
        reportableTotal: 0n,
        excludedTotal: 0n,
        status: 'BELOW',
      };
      byVendor.set(p.vendorId, v);
    }
    if (p.excludedFrom1099) {
      v.excludedTotal += p.amount;
    } else {
      v.byBox[p.boxCode] = (v.byBox[p.boxCode] ?? 0n) + p.amount;
      v.reportableTotal += p.amount;
    }
  }

  for (const v of byVendor.values()) {
    let status: ThresholdStatus = 'BELOW';
    for (const [boxCode, total] of Object.entries(v.byBox)) {
      const box = BOX_BY_CODE.get(boxCode);
      if (!box) continue;
      const threshold = thresholdFor(config, box.thresholdKey);
      if (total >= threshold) {
        status = 'REPORTABLE';
        break;
      }
      if (total * APPROACHING_DEN >= threshold * APPROACHING_NUM) status = 'APPROACHING';
    }
    v.status = status;
  }

  return [...byVendor.values()].sort((a, b) => (b.reportableTotal > a.reportableTotal ? 1 : -1));
}
