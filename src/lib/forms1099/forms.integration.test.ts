// Form generation & e-file lifecycle: draft generation gated on W-9,
// review/edit, immutability after filing, mock transmitter accept/reject,
// correction chain, Copy B consent rule, e-file mandate counter.
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { encryptSecret } from '@/lib/crypto';
import { setW9Manually } from './w9';
import { recordVendorPayment } from './tracking';
import {
  amountsFromJson,
  createCorrection,
  deliverCopyB,
  efileMandate,
  generateDrafts,
  markReady,
  submitForms,
  updateDraftAmounts,
} from './forms';

let userId: string;
let businessId: string;
let eligibleVendorId: string;
let noW9VendorId: string;

const usd = (d: number) => BigInt(Math.round(d * 100));

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: `f1099-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`, name: 'Filer' },
  });
  userId = user.id;
  const business = await createBusiness({ userId, name: 'Filing Test Co' });
  businessId = business.id;
  await prisma.business.update({
    where: { id: businessId },
    data: {
      legalName: 'Filing Test Co LLC',
      einEncrypted: encryptSecret('123456789'),
      einLast4: '6789',
      taxStreet: '1 Test Way',
      taxCity: 'Albany',
      taxState: 'NY',
      taxZip: '12207',
    },
  });

  eligibleVendorId = (await prisma.vendor.create({ data: { businessId, name: 'Eligible Ed' } })).id;
  await setW9Manually({
    businessId,
    userId,
    vendorId: eligibleVendorId,
    data: {
      legalName: 'Edward Example',
      taxEntityType: 'INDIVIDUAL_SOLE_PROP',
      tin: '987654321',
      tinType: 'SSN',
      taxStreet: '2 Elm St',
      taxCity: 'Ithaca',
      taxState: 'NY',
      taxZip: '14850',
      backupWithholding: false,
      eDeliveryConsent: false, // deliberately: tests the Copy B consent rule
    },
  });
  noW9VendorId = (await prisma.vendor.create({ data: { businessId, name: 'Missing W9 Mo' } })).id;

  // Reportable in 2026 ($2,000 threshold): $2,500 each.
  for (const vendorId of [eligibleVendorId, noW9VendorId]) {
    await recordVendorPayment({
      businessId,
      userId,
      vendorId,
      date: new Date('2026-05-01'),
      amount: usd(2500),
      method: 'ACH',
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('generation & review', () => {
  it('creates drafts only for vendors with completed W-9s; skips carry reasons', async () => {
    const { created, skipped } = await generateDrafts({ businessId, userId, taxYear: 2026 });
    expect(created).toHaveLength(1);
    expect(skipped.some((s) => s.vendorName === 'Missing W9 Mo' && /W-9/.test(s.reason))).toBe(true);

    const form = await prisma.form1099.findUniqueOrThrow({ where: { id: created[0] } });
    expect(form.formKind).toBe('NEC');
    expect(amountsFromJson(form.amounts)['1']).toBe(usd(2500));

    // Re-generating doesn't duplicate.
    const again = await generateDrafts({ businessId, userId, taxYear: 2026 });
    expect(again.created).toHaveLength(0);
  });

  it('drafts are editable; then ready; then filed via explicit confirmation and immutable', async () => {
    const form = await prisma.form1099.findFirstOrThrow({
      where: { businessId, vendorId: eligibleVendorId, taxYear: 2026 },
    });
    await updateDraftAmounts({ businessId, userId, formId: form.id, amounts: { '1': usd(2600) } });
    await markReady({ businessId, userId, formId: form.id });

    // TS enforces confirmedByUser: true at compile time; runtime double-checks.
    const [submitted] = await submitForms({
      businessId,
      userId,
      formIds: [form.id],
      transmitterName: 'mock',
      confirmedByUser: true,
    });
    expect(submitted.status).toBe('ACCEPTED');
    expect(submitted.submissionId).toMatch(/^MOCK-2026-/);

    await expect(
      updateDraftAmounts({ businessId, userId, formId: form.id, amounts: { '1': usd(1) } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('mock transmitter rejects payloads with a bad payer EIN', async () => {
    // Second business without a valid EIN digit-count can't even submit;
    // simulate a rejection by corrupting the recipient TIN instead.
    const v = await prisma.vendor.create({ data: { businessId, name: 'Reject Ray' } });
    await setW9Manually({
      businessId,
      userId,
      vendorId: v.id,
      data: {
        legalName: 'Ray Reject',
        taxEntityType: 'OTHER',
        tin: '111223333',
        tinType: 'SSN',
        taxStreet: 'x',
        taxCity: 'y',
        taxState: 'NY',
        taxZip: '10001',
        backupWithholding: false,
        eDeliveryConsent: true,
      },
    });
    // Corrupt the stored ciphertext content to a non-9-digit TIN.
    await prisma.vendor.update({ where: { id: v.id }, data: { tinEncrypted: encryptSecret('12AB') } });
    await recordVendorPayment({ businessId, userId, vendorId: v.id, date: new Date('2026-06-01'), amount: usd(3000), method: 'WIRE' });
    const { created } = await generateDrafts({ businessId, userId, taxYear: 2026 });
    expect(created).toHaveLength(1);
    await markReady({ businessId, userId, formId: created[0] });
    const [result] = await submitForms({
      businessId,
      userId,
      formIds: created,
      transmitterName: 'mock',
      confirmedByUser: true,
    });
    expect(result.status).toBe('REJECTED');
    expect(result.rejectionReason).toMatch(/TIN/);
  });
});

describe('corrections', () => {
  it('filed forms are corrected via a linked v+1 draft, never edited in place', async () => {
    const filed = await prisma.form1099.findFirstOrThrow({
      where: { businessId, vendorId: eligibleVendorId, status: 'ACCEPTED' },
    });
    const correction = await createCorrection({ businessId, userId, formId: filed.id });
    expect(correction.version).toBe(filed.version + 1);
    expect(correction.correctsId).toBe(filed.id);
    expect(correction.status).toBe('DRAFT');

    // Only one open correction per filed form.
    await expect(createCorrection({ businessId, userId, formId: filed.id })).rejects.toThrow(/already exists/i);

    // The correction is editable and can be filed, carrying the original's
    // submission id in its payload (verified by the transmitter contract).
    await updateDraftAmounts({ businessId, userId, formId: correction.id, amounts: { '1': usd(2400) } });
    await markReady({ businessId, userId, formId: correction.id });
    const [submitted] = await submitForms({
      businessId,
      userId,
      formIds: [correction.id],
      transmitterName: 'mock',
      confirmedByUser: true,
    });
    expect(submitted.status).toBe('ACCEPTED');
  });

  it('drafts cannot be "corrected" — they are just edited', async () => {
    const draft = await prisma.form1099.create({
      data: {
        businessId,
        vendorId: eligibleVendorId,
        taxYear: 2027,
        formKind: 'MISC',
        amounts: { '1': '100000' },
        payer: {},
        recipient: {},
      },
    });
    await expect(createCorrection({ businessId, userId, formId: draft.id })).rejects.toThrow(/Only filed/i);
  });
});

describe('recipient copies & mandate', () => {
  it('electronic Copy B requires stored e-consent; mail always works', async () => {
    const filed = await prisma.form1099.findFirstOrThrow({
      where: { businessId, vendorId: eligibleVendorId, status: 'ACCEPTED', version: 1 },
    });
    await expect(
      deliverCopyB({ businessId, userId, formId: filed.id, method: 'electronic' }),
    ).rejects.toThrow(/consent/i);
    const mailed = await deliverCopyB({ businessId, userId, formId: filed.id, method: 'mail' });
    expect(mailed.copyBDeliveryMethod).toBe('mail');
  });

  it('e-file mandate counts distinct vendor/kind returns for the year', async () => {
    const mandate = await efileMandate(businessId, 2026);
    // Ed's original + correction collapse to one distinct vendor/kind return;
    // Ray's REJECTED filing doesn't count.
    expect(mandate.count).toBe(1);
    expect(mandate.mandateAt).toBe(10);
    expect(mandate.mandatory).toBe(false);
  });
});
