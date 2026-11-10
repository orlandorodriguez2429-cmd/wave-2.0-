// Forgot password. The link is single use, valid 60 minutes, and only a hash
// of its token is stored. Requesting a reset never reveals whether an email
// has an account. Resetting ends all sessions and clears a lockout, but does
// NOT bypass two-step verification: the next sign-in still asks for a code.
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { getEmailProvider } from '@/lib/email/provider';
import { appUrl, hashToken, MIN_PASSWORD_LENGTH } from '@/lib/invites';

export const RESET_TTL_MINUTES = 60;

export class ResetError extends Error {}

/** Always resolves the same way; sends an email only if the account exists. */
export async function requestPasswordReset(email: string, now = new Date()): Promise<{ link?: string }> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
  });
  if (!user?.passwordHash || user.memberships.length === 0) return {};
  const token = randomBytes(32).toString('base64url');
  await prisma.$transaction([
    // Only the newest link works.
    prisma.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TTL_MINUTES * 60_000) },
    }),
  ]);
  const link = `${appUrl()}/reset/${token}`;
  await getEmailProvider().send({
    to: user.email,
    subject: 'Reset your password — Your Tax Solution Books',
    text:
      `Someone asked to reset the password for this account.\n\n` +
      `Set a new password here (the link works once and expires in ${RESET_TTL_MINUTES} minutes):\n${link}\n\n` +
      `You'll still need your two-step verification code to sign in.\n` +
      `If this wasn't you, ignore this email — your password stays the same.`,
  });
  await prisma.auditLog.create({
    data: { businessId: user.memberships[0].businessId, userId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, payload: {} },
  });
  return { link };
}

export async function checkResetToken(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt <= now) return null;
  return row;
}

export async function resetPassword(token: string, newPassword: string, now = new Date()) {
  if (newPassword.length < MIN_PASSWORD_LENGTH) throw new ResetError(`Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  const row = await checkResetToken(token, now);
  if (!row) throw new ResetError('This reset link is not valid any more. Ask for a new one.');
  const claimed = await prisma.passwordReset.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (claimed.count !== 1) throw new ResetError('This reset link was already used.');
  const user = await prisma.user.update({
    where: { id: row.userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      sessionVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    },
    include: { memberships: { take: 1, orderBy: { createdAt: 'asc' } } },
  });
  if (user.memberships[0]) {
    await prisma.auditLog.create({
      data: { businessId: user.memberships[0].businessId, userId: user.id, action: 'auth.password_reset', entityType: 'user', entityId: user.id, payload: {} },
    });
  }
}
