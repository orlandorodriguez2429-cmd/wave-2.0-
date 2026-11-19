// The ledger records who created every entry. Entries posted by the automatic
// pipeline (rules, built-in merchant rules, AI, transfers) are attributed to
// this built-in user, which has no password and can never log in. The audit
// log records the same actions with userId = null plus how they were decided.
import { prisma } from '@/lib/db';

const SYSTEM_EMAIL = 'automation@system.invalid';
let cached: string | null = null;

export async function systemUserId(): Promise<string> {
  if (cached) return cached;
  const user = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    update: {},
    create: { email: SYSTEM_EMAIL, name: 'Automatic categorization', passwordHash: null },
  });
  cached = user.id;
  return user.id;
}
