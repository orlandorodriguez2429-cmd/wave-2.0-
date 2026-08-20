import { prisma } from '@/lib/db';
import { decryptSecret } from '@/lib/crypto';
import { BOXES } from './boxes';
import { vendor1099Totals } from './tracking';
import { getTaxYearConfig } from './thresholds';
import { getTransmitter, type FilingPayload } from './transmitter';

export class Form1099Error extends Error {}

type Amounts = Record<string, bigint>;

function amountsToJson(a: Amounts): Record<string, string> {
  return Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.toString()]));
}

export function amountsFromJson(json: unknown): Amounts {
  return Object.fromEntries(Object.entries((json ?? {}) as Record<string, string>).map(([k, v]) => [k, BigInt(v)]));
}

/**
 * Generate DRAFT forms for every reportable vendor in the tax year, split by
 * form kind. Skips (with a reason, never silently): vendors without a
 * completed W-9, and vendor/kind pairs that already have an active form.
 */
export async function generateDrafts(opts: { businessId: string; userId: string; taxYear: number }) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  const totals = await vendor1099Totals(opts.businessId, opts.taxYear);
  const created: string[] = [];
  const skipped: Array<{ vendorName: string; reason: string }> = [];

  for (const t of totals) {
    if (t.status !== 'REPORTABLE') continue;
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: t.vendorId } });
    if (!vendor.is1099Eligible || vendor.w9Status !== 'COMPLETED') {
      skipped.push({ vendorName: t.vendorName, reason: 'No completed W-9 — collect it first.' });
      continue;
    }

    // Split box totals by form kind.
    const byKind = new Map<string, Amounts>();
    for (const [code, amount] of Object.entries(t.byBox)) {
      const box = BOXES.find((b) => b.code === code);
      if (!box || amount <= 0n) continue;
      const kind = byKind.get(box.form) ?? {};
      kind[box.box] = (kind[box.box] ?? 0n) + amount;
      byKind.set(box.form, kind);
    }

    for (const [formKind, amounts] of byKind) {
      if (formKind === 'INT' || formKind === 'DIV') {
        skipped.push({ vendorName: t.vendorName, reason: `1099-${formKind} generation is stubbed (tracked, not yet generated).` });
        continue;
      }
      const existing = await prisma.form1099.findFirst({
        where: {
          businessId: opts.businessId,
          vendorId: t.vendorId,
          taxYear: opts.taxYear,
          formKind,
          status: { not: 'REJECTED' },
        },
        orderBy: { version: 'desc' },
      });
      if (existing) {
        skipped.push({ vendorName: t.vendorName, reason: `1099-${formKind} already exists (v${existing.version}, ${existing.status}).` });
        continue;
      }
      const form = await prisma.form1099.create({
        data: {
          businessId: opts.businessId,
          vendorId: t.vendorId,
          taxYear: opts.taxYear,
          formKind,
          amounts: amountsToJson(amounts),
          payer: {
            name: business.legalName || business.name,
            addressLine: [business.taxStreet, business.taxCity, business.taxState, business.taxZip]
              .filter(Boolean)
              .join(', '),
            tinLast4: business.einLast4,
          },
          recipient: {
            name: vendor.legalName || vendor.name,
            businessName: vendor.businessName,
            addressLine: [vendor.taxStreet, vendor.taxCity, vendor.taxState, vendor.taxZip].filter(Boolean).join(', '),
            tinLast4: vendor.tinLast4,
            tinType: vendor.tinType,
            state: vendor.taxState,
          },
        },
      });
      created.push(form.id);
      await prisma.auditLog.create({
        data: {
          businessId: opts.businessId,
          userId: opts.userId,
          action: 'form1099.generated',
          entityType: 'form1099',
          entityId: form.id,
          payload: { vendorName: t.vendorName, taxYear: opts.taxYear, formKind },
        },
      });
    }
  }
  return { created, skipped };
}

const MUTABLE: ReadonlySet<string> = new Set(['DRAFT']);

/** Review step: adjust box amounts while the form is still a draft. */
export async function updateDraftAmounts(opts: {
  businessId: string;
  userId: string;
  formId: string;
  amounts: Amounts;
}) {
  const form = await prisma.form1099.findUniqueOrThrow({ where: { id: opts.formId } });
  if (form.businessId !== opts.businessId) throw new Form1099Error('Wrong business.');
  if (!MUTABLE.has(form.status)) {
    throw new Form1099Error(`A ${form.status} form is immutable — file a correction instead.`);
  }
  if (Object.values(opts.amounts).some((v) => v < 0n)) throw new Form1099Error('Amounts cannot be negative.');
  const updated = await prisma.form1099.update({
    where: { id: form.id },
    data: { amounts: amountsToJson(opts.amounts) },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'form1099.amounts_edited',
      entityType: 'form1099',
      entityId: form.id,
      payload: { amounts: amountsToJson(opts.amounts) },
    },
  });
  return updated;
}

export async function markReady(opts: { businessId: string; userId: string; formId: string }) {
  const form = await prisma.form1099.findUniqueOrThrow({ where: { id: opts.formId } });
  if (form.businessId !== opts.businessId) throw new Form1099Error('Wrong business.');
  if (form.status !== 'DRAFT') throw new Form1099Error('Only drafts can be marked ready.');
  const amounts = amountsFromJson(form.amounts);
  if (!Object.values(amounts).some((v) => v > 0n)) {
    throw new Form1099Error('At least one box amount must be positive.');
  }
  const business = await prisma.business.findUniqueOrThrow({ where: { id: form.businessId } });
  if (!business.einEncrypted) {
    throw new Form1099Error('Set the payer EIN in 1099 settings before readying forms.');
  }
  const updated = await prisma.form1099.update({ where: { id: form.id }, data: { status: 'READY' } });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'form1099.marked_ready',
      entityType: 'form1099',
      entityId: form.id,
    },
  });
  return updated;
}

/**
 * Submit READY forms to a transmitter. `confirmedByUser` must be literally
 * true — every calling path is an explicit human "Submit to IRS" click; there
 * is no auto-file path anywhere in the codebase (hard compliance rule).
 * TINs/EINs are decrypted just-in-time and only handed to the transmitter.
 */
export async function submitForms(opts: {
  businessId: string;
  userId: string;
  formIds: string[];
  transmitterName: string;
  confirmedByUser: true;
}) {
  if (opts.confirmedByUser !== true) throw new Form1099Error('Submission requires explicit user confirmation.');
  if (opts.formIds.length === 0) throw new Form1099Error('No forms selected.');
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });
  if (!business.einEncrypted) throw new Form1099Error('Payer EIN is not set.');
  const payerEin = decryptSecret(business.einEncrypted);

  const forms = await prisma.form1099.findMany({ where: { id: { in: opts.formIds } } });
  const payloads: FilingPayload[] = [];
  for (const form of forms) {
    if (form.businessId !== opts.businessId) throw new Form1099Error('Wrong business.');
    if (form.status !== 'READY') throw new Form1099Error(`Form ${form.id} is ${form.status}, not READY.`);
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: form.vendorId } });
    if (!vendor.tinEncrypted) throw new Form1099Error(`Vendor ${vendor.name} has no TIN on file.`);
    const corrected = form.correctsId
      ? await prisma.form1099.findUnique({ where: { id: form.correctsId } })
      : null;
    const recipient = form.recipient as { name: string; addressLine: string; tinType?: string };
    const payer = form.payer as { name: string; addressLine: string };
    payloads.push({
      formId: form.id,
      taxYear: form.taxYear,
      formKind: form.formKind,
      payer: { name: payer.name, ein: payerEin, addressLine: payer.addressLine },
      recipient: {
        name: recipient.name,
        tin: decryptSecret(vendor.tinEncrypted),
        tinType: recipient.tinType ?? 'SSN',
        addressLine: recipient.addressLine,
      },
      amounts: Object.fromEntries(Object.entries(amountsFromJson(form.amounts)).map(([k, v]) => [k, v.toString()])),
      correctsSubmissionId: corrected?.submissionId ?? undefined,
    });
  }

  const transmitter = getTransmitter(opts.transmitterName);
  const results = await transmitter.submit(payloads);

  const updated = [];
  for (const result of results) {
    const formId = payloads[results.indexOf(result)].formId;
    const now = new Date();
    updated.push(
      await prisma.form1099.update({
        where: { id: formId },
        data: {
          status: result.status,
          transmitter: transmitter.name,
          submissionId: result.submissionId,
          submittedAt: now,
          acceptedAt: result.status === 'ACCEPTED' ? now : null,
          rejectionReason: result.status === 'REJECTED' ? (result.message ?? 'Rejected') : null,
        },
      }),
    );
    await prisma.auditLog.create({
      data: {
        businessId: opts.businessId,
        userId: opts.userId,
        action: `form1099.${result.status.toLowerCase()}`,
        entityType: 'form1099',
        entityId: formId,
        payload: { transmitter: transmitter.name, submissionId: result.submissionId, message: result.message },
      },
    });
  }
  return updated;
}

/** Start a correction: new DRAFT with version+1 linked to the filed form. */
export async function createCorrection(opts: { businessId: string; userId: string; formId: string }) {
  const original = await prisma.form1099.findUniqueOrThrow({ where: { id: opts.formId } });
  if (original.businessId !== opts.businessId) throw new Form1099Error('Wrong business.');
  if (!['SUBMITTED', 'ACCEPTED'].includes(original.status)) {
    throw new Form1099Error('Only filed (submitted/accepted) forms can be corrected — drafts are just edited.');
  }
  const existing = await prisma.form1099.findUnique({ where: { correctsId: original.id } });
  if (existing) throw new Form1099Error('A correction already exists for this form.');

  const correction = await prisma.form1099.create({
    data: {
      businessId: original.businessId,
      vendorId: original.vendorId,
      taxYear: original.taxYear,
      formKind: original.formKind,
      version: original.version + 1,
      correctsId: original.id,
      amounts: original.amounts as object,
      payer: original.payer as object,
      recipient: original.recipient as object,
    },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'form1099.correction_started',
      entityType: 'form1099',
      entityId: correction.id,
      payload: { corrects: original.id, version: correction.version },
    },
  });
  return correction;
}

/** Record Copy B delivery. Electronic-only delivery requires stored e-consent. */
export async function deliverCopyB(opts: {
  businessId: string;
  userId: string;
  formId: string;
  method: 'electronic' | 'mail';
}) {
  const form = await prisma.form1099.findUniqueOrThrow({ where: { id: opts.formId } });
  if (form.businessId !== opts.businessId) throw new Form1099Error('Wrong business.');
  if (!['SUBMITTED', 'ACCEPTED'].includes(form.status)) {
    throw new Form1099Error('Deliver Copy B after the form is filed.');
  }
  if (opts.method === 'electronic') {
    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: form.vendorId } });
    if (!vendor.eDeliveryConsentAt) {
      throw new Form1099Error(
        'This contractor has not consented to electronic-only delivery — the IRS requires affirmative consent; mail a paper copy instead.',
      );
    }
  }
  const updated = await prisma.form1099.update({
    where: { id: form.id },
    data: { copyBDeliveredAt: new Date(), copyBDeliveryMethod: opts.method },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'form1099.copy_b_delivered',
      entityType: 'form1099',
      entityId: form.id,
      payload: { method: opts.method },
    },
  });
  return updated;
}

/**
 * E-file mandate check: count this year's information returns (latest version
 * per vendor/kind). NOTE: the IRS counts ALL covered return types combined —
 * W-2s and others too — so this is a floor; the UI says so.
 */
export async function efileMandate(businessId: string, taxYear: number) {
  const config = await getTaxYearConfig(taxYear);
  const forms = await prisma.form1099.findMany({
    where: { businessId, taxYear, status: { not: 'REJECTED' } },
    orderBy: { version: 'desc' },
  });
  const distinct = new Set(forms.map((f) => `${f.vendorId}:${f.formKind}`));
  return {
    count: distinct.size,
    mandateAt: config.efileMandateCount,
    mandatory: distinct.size >= config.efileMandateCount,
  };
}
