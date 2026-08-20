import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { readSession, requireRole } from '@/lib/auth';
import type { MembershipRole } from '@/generated/prisma/enums';

export interface AppContext {
  user: { id: string; email: string; name: string };
  business: NonNullable<Awaited<ReturnType<typeof prisma.business.findUnique>>>;
  role: MembershipRole;
  memberships: Array<{ businessId: string; businessName: string; role: MembershipRole }>;
}

/**
 * Resolve the signed session cookie into user + active business + role.
 * Membership is re-checked against the DB every request — a revoked member's
 * cookie is worthless. No session → /login.
 */
export async function getCurrentContext(): Promise<AppContext> {
  const session = await readSession();
  if (!session) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { memberships: { include: { business: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!user || user.memberships.length === 0) redirect('/login');

  const membership =
    user.memberships.find((m) => m.businessId === session.businessId) ?? user.memberships[0];

  return {
    user: { id: user.id, email: user.email, name: user.name },
    business: membership.business,
    role: membership.role,
    memberships: user.memberships.map((m) => ({
      businessId: m.businessId,
      businessName: m.business.name,
      role: m.role,
    })),
  };
}

/** Context + role gate in one call — mutating actions state their floor here. */
export async function requireContext(minimum: MembershipRole): Promise<AppContext> {
  const ctx = await getCurrentContext();
  requireRole(ctx.role, minimum);
  return ctx;
}
