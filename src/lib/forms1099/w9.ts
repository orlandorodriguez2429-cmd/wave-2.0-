import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { encryptSecret, maskTail } from '@/lib/crypto';
import type { TaxEntityType, TinType } from '@/generated/prisma/enums';

// W-9 collection. TIN handling rules (non-negotiable, see PROJECT.md):
//  - stored ONLY as AES-256-GCM ciphertext + last-4 for display
//  - never in audit payloads, logs, or error messages
//  - masked everywhere in the UI

export interface W9Data {
  legalName: string;
  businessName?: string;
  taxEntityType: TaxEntityType;
  tin: string; // 9 digits, formatting stripped
  tinType: TinType;
  taxStreet: string;
  taxCity: string;
  taxState: string;
  taxZip: string;
  backupWithholding: boolean;
  /** Contractor consented to electronic-only Copy B delivery. */
  eDeliveryConsent: boolean;
}

export function normalizeTin(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length !== 9) throw new Error('TIN must be 9 digits (SSN or EIN).');
  return digits;
}

/** Generate a request token and mark the vendor as awaiting W-9. */
export async function requestW9(opts: { businessId: string; userId: string; vendorId: string }) {
  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: opts.vendorId } });
  if (vendor.businessId !== opts.businessId) throw new Error('Wrong business.');
  const token = randomBytes(24).toString('base64url');
  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: { w9Status: 'REQUESTED', w9RequestToken: token, w9RequestedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'vendor.w9_requested',
      entityType: 'vendor',
      entityId: vendor.id,
      payload: { vendorName: vendor.name },
    },
  });
  return updated;
}

function w9UpdateData(data: W9Data) {
  const tin = normalizeTin(data.tin);
  return {
    legalName: data.legalName.trim(),
    businessName: data.businessName?.trim() || null,
    taxEntityType: data.taxEntityType,
    tinEncrypted: encryptSecret(tin),
    tinLast4: tin.slice(-4),
    tinType: data.tinType,
    taxStreet: data.taxStreet.trim(),
    taxCity: data.taxCity.trim(),
    taxState: data.taxState.trim().toUpperCase(),
    taxZip: data.taxZip.trim(),
    backupWithholding: data.backupWithholding,
    eDeliveryConsentAt: data.eDeliveryConsent ? new Date() : null,
    w9Status: 'COMPLETED' as const,
    w9CompletedAt: new Date(),
    is1099Eligible: true,
  };
}

function validateW9(data: W9Data) {
  if (!data.legalName.trim()) throw new Error('Legal name is required.');
  if (!data.taxStreet.trim() || !data.taxCity.trim() || !data.taxState.trim() || !data.taxZip.trim()) {
    throw new Error('Complete address is required.');
  }
  if (!/^[A-Za-z]{2}$/.test(data.taxState.trim())) throw new Error('State must be a 2-letter code.');
  if (!/^\d{5}(-\d{4})?$/.test(data.taxZip.trim())) throw new Error('ZIP must be 12345 or 12345-6789.');
}

/** Contractor-side submission via the public tokenized form. */
export async function submitW9ByToken(token: string, data: W9Data) {
  validateW9(data);
  const vendor = await prisma.vendor.findUnique({ where: { w9RequestToken: token } });
  if (!vendor || vendor.w9Status !== 'REQUESTED') {
    throw new Error('This W-9 request link is invalid or already used.');
  }
  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: { ...w9UpdateData(data), w9RequestToken: null },
  });
  await prisma.auditLog.create({
    data: {
      businessId: vendor.businessId,
      userId: null, // submitted by the contractor, not an app user
      action: 'vendor.w9_submitted',
      entityType: 'vendor',
      entityId: vendor.id,
      payload: { via: 'public_link', tinLast4: updated.tinLast4, eConsent: !!updated.eDeliveryConsentAt },
    },
  });
  return updated;
}

/** Owner/bookkeeper enters W-9 data directly (paper form in hand). */
export async function setW9Manually(opts: { businessId: string; userId: string; vendorId: string; data: W9Data }) {
  validateW9(opts.data);
  const vendor = await prisma.vendor.findUniqueOrThrow({ where: { id: opts.vendorId } });
  if (vendor.businessId !== opts.businessId) throw new Error('Wrong business.');
  const updated = await prisma.vendor.update({
    where: { id: vendor.id },
    data: { ...w9UpdateData(opts.data), w9RequestToken: null },
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.userId,
      action: 'vendor.w9_entered',
      entityType: 'vendor',
      entityId: vendor.id,
      payload: { via: 'manual', tinLast4: updated.tinLast4 },
    },
  });
  return updated;
}

export function maskedTin(vendor: { tinLast4: string | null; tinType: string | null }): string {
  if (!vendor.tinLast4) return '—';
  return vendor.tinType === 'EIN' ? `**-***${vendor.tinLast4}` : maskTail(`*****${vendor.tinLast4}`, 4);
}
