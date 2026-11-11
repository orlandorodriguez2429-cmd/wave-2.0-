// Create the first owner account + business on a fresh production database
// (production has no demo data). Run from your own computer:
//   DATABASE_URL=... ENCRYPTION_KEY=... npx tsx scripts/create-owner.ts you@example.com "Your Name" "Office LLC"
// Prints a one-time password; you set up two-step verification at first sign-in.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { createBusiness } from '../src/lib/ledger/business';

async function main() {
  const [email, name, businessName] = process.argv.slice(2);
  if (!email || !name || !businessName) {
    console.error('Usage: npx tsx scripts/create-owner.ts <email> "<your name>" "<business name>"');
    process.exit(1);
  }
  const normalized = email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email: normalized } })) {
    console.error('That email already has an account.');
    process.exit(1);
  }
  const password = randomBytes(12).toString('base64url');
  const user = await prisma.user.create({ data: { email: normalized, name, passwordHash: await hashPassword(password) } });
  const business = await createBusiness({ userId: user.id, name: businessName });
  console.log(`Created owner ${normalized} for "${business.name}".`);
  console.log(`One-time password: ${password}`);
  console.log('Sign in, set up two-step verification, and keep this password somewhere safe (or store it in your password manager).');
}

main().finally(() => prisma.$disconnect());
