// Cookie-session auth. The session cookie carries a signed payload (see
// session-core.ts): user, active business, role, session version and
// activity timestamps. A full session exists only after password AND MFA.
// Membership and session version are re-validated against the DB on every
// request (context.ts), so a revoked member's or rotated cookie is worthless.
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import type { MembershipRole } from '@/generated/prisma/enums';
import {
  cookieOptions,
  MAX_SESSION_SECONDS,
  newSession,
  PENDING_MFA_SECONDS,
  pendingCookieName,
  sessionCookieName,
  sessionIsLive,
  signToken,
  verifyToken,
  type PendingMfaPayload,
  type SessionPayload,
} from './session-core';

export { sessionCookieName, pendingCookieName };

/** Live session whose version still matches the user's (else null). */
export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const payload = await verifyToken(store.get(sessionCookieName())?.value);
  if (!sessionIsLive(payload)) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { sessionVersion: true } });
  if (!user || user.sessionVersion !== payload.sv) return null;
  return payload;
}

/** Kill every existing session of a user (privilege or credential change). */
export async function rotateSessions(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
}

/** Issue a brand-new session cookie (login, MFA done, business switch). */
export async function startSession(opts: { userId: string; businessId: string; role: MembershipRole; sv: number }) {
  const store = await cookies();
  store.set(sessionCookieName(), await signToken(newSession(opts)), cookieOptions(MAX_SESSION_SECONDS));
  store.delete(pendingCookieName());
}

export async function endSession() {
  const store = await cookies();
  store.delete(sessionCookieName());
  store.delete(pendingCookieName());
}

export async function setPendingMfa(p: Omit<PendingMfaPayload, 'kind' | 'iat' | 'exp'>) {
  const now = Math.floor(Date.now() / 1000);
  const store = await cookies();
  store.delete(sessionCookieName());
  store.set(
    pendingCookieName(),
    await signToken({ kind: 'pending-mfa', ...p, iat: now, exp: now + PENDING_MFA_SECONDS }),
    cookieOptions(PENDING_MFA_SECONDS),
  );
}

export async function readPendingMfa(): Promise<PendingMfaPayload | null> {
  const store = await cookies();
  const p = await verifyToken(store.get(pendingCookieName())?.value);
  if (!p || p.kind !== 'pending-mfa' || p.exp < Date.now() / 1000) return null;
  return p;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | null = null;
/** Spend the same time as a real check when the email doesn't exist. */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash('not-a-real-password', 12);
  await bcrypt.compare(password, await dummyHash);
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user?.passwordHash) return null;
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

// --- Role-based permission model -------------------------------------------
// OWNER: everything.
// ACCOUNTANT: all bookkeeping incl. 1099 filing; not team/settings management.
// EMPLOYEE: create drafts/expenses; cannot post to or reverse the ledger,
//           approve/void documents, file 1099s, or touch settings.
// CONTRACTOR_VIEW: read-only.
// CLIENT: read-only portal for one business; ranks below everything, and is
// additionally fenced out of every staff route (middleware + context.ts).
const ROLE_RANK: Record<MembershipRole, number> = {
  OWNER: 3,
  ACCOUNTANT: 2,
  EMPLOYEE: 1,
  CONTRACTOR_VIEW: 0,
  CLIENT: -1,
};

export class ForbiddenError extends Error {
  constructor(needed: string) {
    super(`Your role does not allow this action (requires ${needed}).`);
    this.name = 'ForbiddenError';
  }
}

export function requireRole(role: MembershipRole, minimum: MembershipRole): void {
  if (ROLE_RANK[role] < ROLE_RANK[minimum]) throw new ForbiddenError(`${minimum} or higher`);
}
