// Client invitations: single-use link, token stored only as a SHA-256 hash,
// valid for 72 hours. Accepting creates (or reuses) the user, sets their
// password, adds the CLIENT membership, and sends them to MFA setup.
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { getEmailProvider } from '@/lib/email/provider';
import type { MembershipRole } from '@/generated/prisma/enums';

export const INVITE_TTL_HOURS = 72;
export const MIN_PASSWORD_LENGTH = 12;

export class InviteError extends Error {}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export async function createInvite(opts: {
  businessId: string;
  invitedById: string;
  email: string;
  role?: MembershipRole;
  now?: Date;
}): Promise<{ inviteId: string; link: string }> {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InviteError('Enter a valid email address.');
  const role = opts.role ?? 'CLIENT';
  const business = await prisma.business.findUniqueOrThrow({ where: { id: opts.businessId } });

  const existing = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
  if (existing?.memberships.some((m) => m.businessId === opts.businessId)) {
    throw new InviteError('That person already has access to this business.');
  }
  if (role === 'CLIENT' && existing && existing.memberships.length > 0) {
    // A client login sees exactly one business.
    throw new InviteError('That email already has access to another business. Use a different email for this client.');
  }

  const now = opts.now ?? new Date();
  const token = randomBytes(32).toString('base64url');
  const invite = await prisma.$transaction(async (tx) => {
    // Only the newest link for this person works.
    await tx.invite.updateMany({
      where: { businessId: opts.businessId, email, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.invite.create({
      data: {
        businessId: opts.businessId,
        email,
        role,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_HOURS * 3600_000),
        createdById: opts.invitedById,
      },
    });
  });
  const link = `${appUrl()}/invite/${token}`;
  await getEmailProvider().send({
    to: email,
    subject: `${business.name}: your bookkeeping portal`,
    text:
      `You've been invited to view the books for ${business.name}.\n\n` +
      `Set up your login here (the link works once and expires in ${INVITE_TTL_HOURS} hours):\n${link}\n\n` +
      `You'll choose a password and set up a sign-in code app (two-step verification).\n` +
      `If you weren't expecting this, ignore this email.`,
  });
  await prisma.auditLog.create({
    data: {
      businessId: opts.businessId,
      userId: opts.invitedById,
      action: 'invite.sent',
      entityType: 'invite',
      entityId: invite.id,
      payload: { email, role, expiresAt: invite.expiresAt.toISOString() },
    },
  });
  return { inviteId: invite.id, link };
}

export async function findInvite(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { invite: null, problem: 'invalid' as const };
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite) return { invite: null, problem: 'invalid' as const };
  if (invite.usedAt) return { invite: null, problem: 'used' as const };
  if (invite.revokedAt) return { invite: null, problem: 'revoked' as const };
  if (invite.expiresAt <= now) return { invite: null, problem: 'expired' as const };
  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  return { invite, problem: null, existingUser: !!existing?.passwordHash };
}

export async function acceptInvite(opts: { token: string; name?: string; password: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const found = await findInvite(opts.token, now);
  if (!found.invite) throw new InviteError('This invitation link is not valid any more. Ask for a new one.');
  const invite = found.invite;

  let user = await prisma.user.findUnique({ where: { email: invite.email }, include: { memberships: true } });
  if (user?.passwordHash) {
    if (!(await verifyPassword(opts.password, user.passwordHash))) throw new InviteError('Wrong password for this email.');
  } else if (opts.password.length < MIN_PASSWORD_LENGTH) {
    throw new InviteError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (invite.role === 'CLIENT' && user && user.memberships.length > 0) {
    throw new InviteError('This email already has access to another business.');
  }

  // Claim the invite atomically: a link works exactly once.
  const claimed = await prisma.invite.updateMany({
    where: { id: invite.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw new InviteError('This invitation link was already used.');

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: invite.email,
        name: (opts.name ?? '').trim().slice(0, 100) || invite.email.split('@')[0],
        passwordHash: await hashPassword(opts.password),
      },
      include: { memberships: true },
    });
  } else if (!user.passwordHash) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(opts.password) } });
  }
  await prisma.membership.create({ data: { userId: user.id, businessId: invite.businessId, role: invite.role } });
  await prisma.auditLog.create({
    data: {
      businessId: invite.businessId,
      userId: user.id,
      action: 'invite.accepted',
      entityType: 'invite',
      entityId: invite.id,
      payload: { role: invite.role },
    },
  });
  return { userId: user.id, businessId: invite.businessId, mfaEnabled: !!user.mfaEnabledAt };
}
