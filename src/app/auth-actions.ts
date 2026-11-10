'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  readSession,
  burnPasswordCheck,
  endSession,
  hashPassword,
  readPendingMfa,
  rotateSessions,
  setPendingMfa,
  startSession,
  verifyPassword,
} from '@/lib/auth';
import { getCurrentContext, requireContext } from '@/lib/context';
import { createBusiness } from '@/lib/ledger/business';
import { confirmEnrollment, resetMfa, verifyLoginCode } from '@/lib/mfa';
import { hit, isLocked, LIMITS, recordFailure, recordSuccess } from '@/lib/rate-limit';
import { acceptInvite, createInvite, InviteError } from '@/lib/invites';
import { deleteBusiness } from '@/lib/retention';
import type { MembershipRole } from '@/generated/prisma/enums';
import type { ActionResult } from './actions';

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
}

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';
const TOO_MANY = 'Too many attempts. Wait 15 minutes and try again.';

async function membershipFor(userId: string, preferBusinessId?: string) {
  const memberships = await prisma.membership.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  return memberships.find((m) => m.businessId === preferBusinessId) ?? memberships[0] ?? null;
}

/** Step 1: password. A full session is only created after the MFA step. */
export async function loginAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const ip = await clientIp();
  const ipOk = await hit(`login:ip:${ip}`, LIMITS.loginPerIp);
  const emailOk = await hit(`login:email:${email}`, LIMITS.loginPerEmail);
  if (!ipOk || !emailOk) return { error: TOO_MANY };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    await burnPasswordCheck(password); // equalize timing
    return { error: GENERIC_LOGIN_ERROR };
  }
  if (isLocked(user)) return { error: 'This account is temporarily locked after too many failed attempts. Try again in 15 minutes.' };
  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailure(user.id);
    return { error: GENERIC_LOGIN_ERROR };
  }
  if (!(await membershipFor(user.id))) return { error: 'This account has no access to any business.' };
  await setPendingMfa({ userId: user.id, stage: user.mfaEnabledAt ? 'verify' : 'enroll' });
  redirect('/login/mfa');
}

/** Step 2a: code from the authenticator app, or a backup code. */
export async function verifyMfaAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const pending = await readPendingMfa();
  if (!pending || pending.stage !== 'verify') redirect('/login');
  if (!(await hit(`mfa:user:${pending.userId}`, LIMITS.mfaPerUser))) return { error: TOO_MANY };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.userId } });
  if (isLocked(user)) return { error: 'This account is temporarily locked. Try again in 15 minutes.' };
  const how = await verifyLoginCode(user.id, String(formData.get('code') ?? ''));
  if (!how) {
    await recordFailure(user.id);
    return { error: 'That code is not right. Use the current 6-digit code, or one of your backup codes.' };
  }
  await recordSuccess(user.id);
  const m = await membershipFor(user.id, pending.businessId);
  if (!m) redirect('/login');
  await startSession({ userId: user.id, businessId: m.businessId, role: m.role, sv: user.sessionVersion });
  await prisma.auditLog.create({
    data: { businessId: m.businessId, userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, payload: { mfa: how, ip: await clientIp() } },
  });
  redirect(m.role === 'CLIENT' ? '/client' : '/');
}

/**
 * Step 2b (first login): confirm the authenticator app. Returns the backup
 * codes to show once. Deliberately sets NO cookies here: changing cookies in
 * a server action makes Next re-render the page, which would navigate away
 * before the codes are shown. The session starts in finishEnrollmentAction.
 */
export async function enrollMfaAction(
  _prev: ActionResult & { backupCodes?: string[] },
  formData: FormData,
): Promise<ActionResult & { backupCodes?: string[] }> {
  const pending = await readPendingMfa();
  if (!pending || pending.stage !== 'enroll') redirect('/login');
  if (!(await hit(`mfa:user:${pending.userId}`, LIMITS.mfaPerUser))) return { error: TOO_MANY };
  const codes = await confirmEnrollment(pending.userId, String(formData.get('code') ?? ''));
  if (!codes) {
    await recordFailure(pending.userId);
    return { error: 'That code is not right. Check the time on your phone and try the current code.' };
  }
  await recordSuccess(pending.userId);
  return { backupCodes: codes };
}

/** After the backup codes were shown: start the session. */
export async function finishEnrollmentAction(): Promise<void> {
  const pending = await readPendingMfa();
  if (!pending || pending.stage !== 'enroll') redirect('/login');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.userId } });
  // Only completes a login whose password step (the pending cookie) came
  // before a successful enrollment in this same sign-in.
  if (!user.mfaEnabledAt || user.mfaEnabledAt.getTime() / 1000 < pending.iat) redirect('/login');
  const m = await membershipFor(user.id, pending.businessId);
  if (!m) redirect('/login');
  await startSession({ userId: user.id, businessId: m.businessId, role: m.role, sv: user.sessionVersion });
  await prisma.auditLog.create({
    data: { businessId: m.businessId, userId: user.id, action: 'auth.mfa_enrolled', entityType: 'user', entityId: user.id, payload: { ip: await clientIp() } },
  });
  redirect(m.role === 'CLIENT' ? '/client' : '/');
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}

export async function switchBusinessAction(businessId: string): Promise<void> {
  const ctx = await getCurrentContext();
  const m = ctx.memberships.find((x) => x.businessId === businessId);
  if (!m) throw new Error('You are not a member of that business.');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  // New session token for the new business/role (rotation on privilege change).
  await startSession({ userId: ctx.user.id, businessId, role: m.role, sv: user.sessionVersion });
  redirect('/');
}

// --- Invites -----------------------------------------------------------------------

export async function inviteClientAction(_prev: ActionResult & { message?: string }, formData: FormData): Promise<ActionResult & { message?: string }> {
  const { user, business } = await requireContext('ACCOUNTANT');
  if (!(await hit(`invite:business:${business.id}`, LIMITS.inviteSendPerBusiness))) return { error: TOO_MANY };
  try {
    const email = String(formData.get('email') ?? '');
    await createInvite({ businessId: business.id, invitedById: user.id, email, role: 'CLIENT' });
    revalidatePath('/settings/team');
    return { message: `Invitation sent to ${email.trim().toLowerCase()}. The link works once and expires in 72 hours.` };
  } catch (err) {
    if (err instanceof InviteError) return { error: err.message };
    throw err;
  }
}

export async function revokeInviteAction(inviteId: string): Promise<void> {
  const { user, business } = await requireContext('ACCOUNTANT');
  const invite = await prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });
  if (invite.businessId !== business.id) throw new Error('Wrong business.');
  await prisma.invite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
  await prisma.auditLog.create({
    data: { businessId: business.id, userId: user.id, action: 'invite.revoked', entityType: 'invite', entityId: invite.id, payload: {} },
  });
  revalidatePath('/settings/team');
}

export async function acceptInviteAction(token: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  if (!(await hit(`invite:ip:${await clientIp()}`, LIMITS.invitePerIp))) return { error: TOO_MANY };
  const password = String(formData.get('password') ?? '');
  if (formData.has('confirm') && formData.get('confirm') !== password) return { error: 'The two passwords do not match.' };
  let result;
  try {
    result = await acceptInvite({ token, name: String(formData.get('name') ?? ''), password });
  } catch (err) {
    if (err instanceof InviteError) return { error: err.message };
    throw err;
  }
  await setPendingMfa({ userId: result.userId, stage: result.mfaEnabled ? 'verify' : 'enroll', businessId: result.businessId });
  redirect('/login/mfa');
}

/** Owner resets a member's MFA (lost phone). Their sessions end; they re-enroll at next login. */
export async function resetMemberMfaAction(membershipId: string): Promise<void> {
  const { user, business } = await requireContext('OWNER');
  const m = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
  if (m.businessId !== business.id) throw new Error('Wrong business.');
  await resetMfa(m.userId);
  await prisma.auditLog.create({
    data: { businessId: business.id, userId: user.id, action: 'auth.mfa_reset', entityType: 'user', entityId: m.userId, payload: {} },
  });
  revalidatePath('/settings/team');
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
  const me = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  await startSession({ userId: ctx.user.id, businessId: business.id, role: 'OWNER', sv: me.sessionVersion });
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
    if (tempPassword.length < 12) {
      return { error: 'New user: set a temporary password of at least 12 characters (they will also set up two-step sign-in).' };
    }
    member = await prisma.user.create({
      data: { email, name: name || email.split('@')[0], passwordHash: await hashPassword(tempPassword) },
    });
  }
  const existing = await prisma.membership.findUnique({
    where: { userId_businessId: { userId: member.id, businessId: business.id } },
  });
  if (existing) return { error: 'Already a member of this business.' };

  if (member && (await prisma.membership.count({ where: { userId: member.id, role: 'CLIENT' } })) > 0) {
    return { error: 'That email is a client login; client logins can only see their own business.' };
  }
  await prisma.membership.create({ data: { userId: member.id, businessId: business.id, role } });
  await rotateSessions(member.id); // privilege change → fresh sign-in
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
  await rotateSessions(membership.userId); // their existing sessions end now
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

/** Owner deletes the whole business (Plaid items removed first; a deletion record is kept). */
export async function deleteBusinessAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { user, business } = await requireContext('OWNER');
  try {
    await deleteBusiness({ businessId: business.id, userId: user.id, confirmName: String(formData.get('confirmName') ?? '') });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not delete.' };
  }
  const next = await prisma.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (next) {
    await startSession({ userId: user.id, businessId: next.businessId, role: next.role, sv: me.sessionVersion });
    redirect('/');
  }
  await endSession();
  redirect('/login');
}

/** Any signed-in user (staff or client) changes their own password. Other sessions end. */
export async function changePasswordAction(_prev: ActionResult & { message?: string }, formData: FormData): Promise<ActionResult & { message?: string }> {
  const session = await readSession();
  if (!session) redirect('/login');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!(await hit(`password:user:${user.id}`, LIMITS.mfaPerUser))) return { error: TOO_MANY };
  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');
  if (!user.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    await recordFailure(user.id);
    return { error: 'Current password is not right.' };
  }
  if (next.length < 12) return { error: 'Choose a new password of at least 12 characters.' };
  if (next !== String(formData.get('confirm') ?? '')) return { error: 'The two new passwords do not match.' };
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } },
  });
  await startSession({ userId: user.id, businessId: session.businessId, role: session.role, sv: updated.sessionVersion });
  await prisma.auditLog.create({
    data: { businessId: session.businessId, userId: user.id, action: 'auth.password_changed', entityType: 'user', entityId: user.id, payload: {} },
  });
  return { message: 'Password changed. Other devices have been signed out.' };
}
