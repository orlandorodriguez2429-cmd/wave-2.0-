import { prisma } from '@/lib/db';

// Placeholder session context until interactive auth ships (later phase):
// every request acts as the seeded demo owner on their first business. All
// service-layer calls already take explicit userId/businessId, so swapping in
// a real session is a change to this file only.
export async function getCurrentContext() {
  const membership = await prisma.membership.findFirst({
    where: { role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
    include: { user: true, business: true },
  });
  if (!membership) {
    throw new Error('No business found — run `npx prisma db seed` first.');
  }
  return {
    user: membership.user,
    business: membership.business,
  };
}
