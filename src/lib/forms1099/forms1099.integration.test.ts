// 1099 tracking against real Postgres: encrypted W-9 flow, automatic payment
// accrual from expenses, the 1099-K card exclusion, and year-dependent
// configurable thresholds.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { createExpense } from '@/lib/expenses';
import { decryptSecret } from '@/lib/crypto';
import { maskedTin, requestW9, setW9Manually, submitW9ByToken } from './w9';
import { recordVendorPayment, vendor1099Totals } from './tracking';
import { getTaxYearConfig } from './thresholds';

let userId: string;
let businessId: string;
let vendorId: string;
let checking: string;
let contractorExpense: string;

const usd = (dollars: number) => BigInt(Math.round(dollars * 100));

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `1099-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Tester' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: '1099 Test Co' });
  businessId = business.id;
  const byCode = async (code: string) =>
    (await prisma.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code } } })).id;
  [checking, contractorExpense] = await Promise.all(['1010', '6900'].map(byCode));
  vendorId = (await prisma.vendor.create({ data: { businessId, name: 'Freelance Fran' } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('W-9 collection', () => {
  it('request -> public token submission stores TIN encrypted with masked display', async () => {
    const requested = await requestW9({ businessId, userId, vendorId });
    expect(requested.w9Status).toBe('REQUESTED');
    expect(requested.w9RequestToken).toBeTruthy();

    const vendor = await submitW9ByToken(requested.w9RequestToken!, {
      legalName: 'Frances Doe',
      taxEntityType: 'INDIVIDUAL_SOLE_PROP',
      tin: '123-45-6789',
      tinType: 'SSN',
      taxStreet: '1 Main St',
      taxCity: 'Brooklyn',
      taxState: 'ny',
      taxZip: '11201',
      backupWithholding: false,
      eDeliveryConsent: true,
    });
    expect(vendor.w9Status).toBe('COMPLETED');
    expect(vendor.is1099Eligible).toBe(true);
    expect(vendor.w9RequestToken).toBeNull(); // single-use link
    expect(vendor.eDeliveryConsentAt).toBeTruthy();
    expect(vendor.taxState).toBe('NY');

    // TIN never stored in plaintext; ciphertext round-trips; display is masked.
    expect(vendor.tinEncrypted).not.toContain('123456789');
    expect(decryptSecret(vendor.tinEncrypted!)).toBe('123456789');
    expect(vendor.tinLast4).toBe('6789');
    expect(maskedTin(vendor)).not.toContain('12345');
    expect(maskedTin(vendor)).toContain('6789');

    // No audit payload ever carries the TIN.
    const logs = await prisma.auditLog.findMany({ where: { businessId } });
    for (const log of logs) {
      expect(JSON.stringify(log.payload ?? {})).not.toContain('123456789');
    }

    // Token is single-use.
    await expect(
      submitW9ByToken(requested.w9RequestToken!, {
        legalName: 'X',
        taxEntityType: 'OTHER',
        tin: '111111111',
        tinType: 'SSN',
        taxStreet: 'x',
        taxCity: 'x',
        taxState: 'NY',
        taxZip: '11201',
        backupWithholding: false,
        eDeliveryConsent: false,
      }),
    ).rejects.toThrow(/invalid or already used/i);
  });

  it('rejects malformed TINs and addresses', async () => {
    const v2 = await prisma.vendor.create({ data: { businessId, name: 'Bad Data Vendor' } });
    await expect(
      setW9Manually({
        businessId,
        userId,
        vendorId: v2.id,
        data: {
          legalName: 'B',
          taxEntityType: 'OTHER',
          tin: '12345', // too short
          tinType: 'EIN',
          taxStreet: 's',
          taxCity: 'c',
          taxState: 'NY',
          taxZip: '11201',
          backupWithholding: false,
          eDeliveryConsent: false,
        },
      }),
    ).rejects.toThrow(/9 digits/);
  });
});

describe('payment accumulation & 1099-K exclusion', () => {
  it('expenses with a vendor accrue automatically; card payments are excluded', async () => {
    // ACH expense: counts.
    await createExpense({
      businessId,
      userId,
      input: {
        vendorId,
        date: new Date('2026-03-01'),
        memo: 'Design sprint',
        currency: 'USD',
        exchangeRate: '1',
        paymentAccountId: checking,
        paymentMethod: 'ACH',
        lines: [{ expenseAccountId: contractorExpense, amount: usd(1500) }],
      },
    });
    // Card expense: recorded but excluded (1099-K).
    await createExpense({
      businessId,
      userId,
      input: {
        vendorId,
        date: new Date('2026-04-01'),
        memo: 'Card-paid project',
        currency: 'USD',
        exchangeRate: '1',
        paymentAccountId: checking,
        paymentMethod: 'CARD',
        lines: [{ expenseAccountId: contractorExpense, amount: usd(5000) }],
      },
    });
    // Manual check payment: counts.
    await recordVendorPayment({
      businessId,
      userId,
      vendorId,
      date: new Date('2026-06-15'),
      amount: usd(700),
      method: 'CHECK',
      source: 'MANUAL',
    });

    const totals = await vendor1099Totals(businessId, 2026);
    const fran = totals.find((t) => t.vendorId === vendorId)!;
    expect(fran.reportableTotal).toBe(usd(2200)); // 1500 + 700, card 5000 excluded
    expect(fran.excludedTotal).toBe(usd(5000));
    expect(fran.byBox['NEC_1']).toBe(usd(2200));
  });

  it('threshold status is year-configurable: $600 in 2025, $2000 in 2026', async () => {
    const c2025 = await getTaxYearConfig(2025);
    const c2026 = await getTaxYearConfig(2026);
    expect(c2025.necMiscThreshold).toBe(60000n);
    expect(c2026.necMiscThreshold).toBe(200000n);

    // 2026: $2,200 ≥ $2,000 → REPORTABLE.
    const totals2026 = await vendor1099Totals(businessId, 2026);
    expect(totals2026.find((t) => t.vendorId === vendorId)!.status).toBe('REPORTABLE');

    // Same $700 payment pattern in 2025 crosses the OLD $600 threshold.
    await recordVendorPayment({
      businessId,
      userId,
      vendorId,
      date: new Date('2025-06-15'),
      amount: usd(700),
      method: 'CHECK',
    });
    const totals2025 = await vendor1099Totals(businessId, 2025);
    expect(totals2025.find((t) => t.vendorId === vendorId)!.status).toBe('REPORTABLE');
  });

  it('flags vendors approaching the threshold (≥80%)', async () => {
    const v3 = await prisma.vendor.create({ data: { businessId, name: 'Almost There LLC' } });
    await recordVendorPayment({
      businessId,
      userId,
      vendorId: v3.id,
      date: new Date('2026-05-01'),
      amount: usd(1700), // 85% of $2,000
      method: 'ACH',
    });
    const totals = await vendor1099Totals(businessId, 2026);
    expect(totals.find((t) => t.vendorId === v3.id)!.status).toBe('APPROACHING');
  });
});
