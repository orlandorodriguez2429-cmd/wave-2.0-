'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireContext } from '@/lib/context';
import { generateToken, hashToken } from '@/lib/api-auth';
import type { ActionResult } from './actions';

export interface TokenResult extends ActionResult {
  /** Plaintext token — shown exactly once. */
  token?: string;
}

export async function createApiTokenAction(_prev: TokenResult, formData: FormData): Promise<TokenResult> {
  const { user, business } = await requireContext('OWNER');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name the token (e.g. "zapier").' };
  const token = generateToken();
  const row = await prisma.apiToken.create({
    data: { businessId: business.id, name, tokenHash: hashToken(token) },
  });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'api_token.created',
      entityType: 'api_token',
      entityId: row.id,
      payload: { name }, // never the token
    },
  });
  revalidatePath('/settings/team');
  return { token };
}

export async function revokeApiTokenAction(tokenId: string): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: tokenId } });
  if (row.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'api_token.revoked',
      entityType: 'api_token',
      entityId: tokenId,
      payload: { name: row.name },
    },
  });
  revalidatePath('/settings/team');
}
