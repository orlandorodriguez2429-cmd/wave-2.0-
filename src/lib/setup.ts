// First-run setup on a fresh production database (no demo data): creates the
// owner account and first business from a web page, so no terminal is
// needed. Only works while the database has NO users, and only with the
// SETUP_CODE from the host's environment settings (which only the owner can
// see). Afterwards the page is gone (404).
import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { createBusiness } from '@/lib/ledger/business';
import { MIN_PASSWORD_LENGTH } from '@/lib/invites';

export class SetupError extends Error {}

export async function setupAvailable(): Promise<boolean> {
  if (!process.env.SETUP_CODE) return false;
  return (await prisma.user.count({ where: { NOT: { email: 'automation@system.invalid' } } })) === 0;
}

export async function runSetup(input: { code: string; name: string; email: string; businessName: string; password: string }) {
  const expected = process.env.SETUP_CODE ?? '';
  const a = createHash('sha256').update(input.code.trim()).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!expected || !timingSafeEqual(a, b)) throw new SetupError('That setup code is not right. Copy SETUP_CODE from your host’s environment settings.');
  if (!(await setupAvailable())) throw new SetupError('Setup was already completed. Sign in instead.');
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new SetupError('Enter a valid email.');
  if (!input.name.trim() || !input.businessName.trim()) throw new SetupError('Enter your name and your office’s name.');
  if (input.password.length < MIN_PASSWORD_LENGTH) throw new SetupError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  const user = await prisma.user.create({ data: { email, name: input.name.trim(), passwordHash: await hashPassword(input.password) } });
  const business = await createBusiness({ userId: user.id, name: input.businessName.trim() });
  await prisma.auditLog.create({
    data: { businessId: business.id, userId: user.id, action: 'setup.completed', entityType: 'user', entityId: user.id, payload: {} },
  });
  return { userId: user.id, businessId: business.id };
}
