'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { authenticate, hashPassword, SESSION_COOKIE, signSession } from '@/lib/auth';
import { getCurrentContext, requireContext } from '@/lib/context';
import { createBusiness } from '@/lib/ledger/business';
import type { MembershipRole } from '@/generated/prisma/enums';
import type { ActionResult } from './actions';

async function setSessionCookie(userId: string, businessId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession({ userId, businessId }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function loginAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const user = await authenticate(email, password);
  if (!user) return { error: 'Invalid email or password.' };
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) return { error: 'This account belongs to no business.' };
  await setSessionCookie(user.id, membership.businessId);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}

export async function switchBusinessAction(businessId: string): Promise<void> {
  const ctx = await getCurrentContext();
  if (!ctx.memberships.some((m) => m.businessId === businessId)) {
    throw new Error('You are not a member of that business.');
  }
  await setSessionCookie(ctx.user.id, businessId);
  redirect('/');
}

export async function createBusinessAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await getCurrentContext(); // any signed-in user can start their own business
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Business name is required.' };
  const business = await createBusiness({
    userId: ctx.user.id,
    name,
    functionalCurrency: String(formData.get('currency') ?? 'USD'),
  });
  await setSessionCookie(ctx.user.id, business.id);
  redirect('/');
}

const ROLES: MembershipRole[] = ['OWNER', 'ACCOUNTANT', 'EMPLOYEE', 'CONTRACTOR_VIEW'];

/** Owner adds a team member (existing user by email, or a new user with a temp password). */
export async function addMemberAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('OWNER');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const name = String(formData.get('name') ?? '').trim();
  const roleRaw = String(formData.get('role') ?? 'EMPLOYEE') as MembershipRole;
  const tempPassword = String(formData.get('tempPassword') ?? '');
  const role = ROLES.includes(roleRaw) ? roleRaw : 'EMPLOYEE';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Valid email required.' };

  let member = await prisma.user.findUnique({ where: { email } });
  if (!member) {
    if (tempPassword.length < 8) {
      return { error: 'New user: set a temporary password of at least 8 characters.' };
    }
    member = await prisma.user.create({
      data: { email, name: name || email.split('@')[0], passwordHash: await hashPassword(tempPassword) },
    });
  }
  const existing = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: member.id, businessId: business.id } },
  });
  if (existing) return { error: 'Already a member of this business.' };

  await prisma.membership.create({ data: { userId: member.id, businessId: business.id, role } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'membership.added',
      entityType: 'membership',
      entityId: member.id,
      payload: { email, role },
    },
  });
  revalidatePath('/settings/team');
  return {};
}

export async function removeMemberAction(membershipId: string): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const membership = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
  if (membership.businessId !== business.id) throw new Error('Wrong business.');
  if (membership.userId === user.id) throw new Error('You cannot remove yourself.');
  await prisma.membership.delete({ where: { id: membershipId } });
  await prisma.auditLog.create({
    data: {
      businessId: business.id,
      userId: user.id,
      action: 'membership.removed',
      entityType: 'membership',
      entityId: membershipId,
      payload: {},
    },
  });
  revalidatePath('/settings/team');
}
