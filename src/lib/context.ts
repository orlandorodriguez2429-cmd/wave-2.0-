import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { readSession, requireRole } from '@/lib/auth';
import type { MembershipRole } from '@/generated/prisma/enums';

export interface AppContext {
  user: { id: string; email: string; name: string };
  business: NonNullable<Awaited<ReturnType<typeof prisma.business.findUnique>>>;
  role: MembershipRole;
  memberships: Array<{ businessId: string; businessName: string; role: MembershipRole }>;
}

async function loadSession() {
  const session = await readSession(); // signature, expiry, idle AND session version
  if (!session) redirect('/login');
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { memberships: { include: { business: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!user || user.memberships.length === 0) redirect('/login');
  return { session, user };
}

/**
 * STAFF context: signed session → user + active business + role.
 * Membership is re-checked against the DB every request. A CLIENT never gets
 * a staff context: every staff page, route handler and server action calls
 * this, so a client reaching one (despite the middleware) gets a 404.
 */
export async function getCurrentContext(): Promise<AppContext> {
  const { session, user } = await loadSession();
  if (user.memberships.some((m) => m.role === 'CLIENT')) notFound();
  const membership = user.memberships.find((m) => m.businessId === session.businessId) ?? user.memberships[0];
  return {
    user: { id: user.id, email: user.email, name: user.name },
    business: membership.business,
    role: membership.role,
    memberships: user.memberships.map((m) => ({ businessId: m.businessId, businessName: m.business.name, role: m.role })),
  };
}

/** Context + role gate in one call — mutating actions state their floor here. */
export async function requireContext(minimum: MembershipRole): Promise<AppContext> {
  const ctx = await getCurrentContext();
  requireRole(ctx.role, minimum);
  return ctx;
}

export interface ClientContext {
  user: { id: string; email: string; name: string };
  business: AppContext['business'];
}

/**
 * CLIENT portal context: exactly one business, the one on the client's
 * membership. Every portal query is scoped by `business.id` from here —
 * never by an id from the URL or a form.
 */
export async function getClientContext(): Promise<ClientContext> {
  const { user } = await loadSession();
  const memberships = user.memberships.filter((m) => m.role === 'CLIENT');
  if (memberships.length !== 1 || user.memberships.length !== 1) notFound();
  return { user: { id: user.id, email: user.email, name: user.name }, business: memberships[0].business };
}
