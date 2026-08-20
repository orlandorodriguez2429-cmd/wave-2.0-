// Cookie-session auth. The session cookie carries a signed JSON payload
// (userId + active businessId) — HMAC-SHA256 with a key derived from
// ENCRYPTION_KEY. No server-side session store needed; membership is
// re-validated against the DB on every request.
import { createHmac, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import type { MembershipRole } from '@/generated/prisma/enums';

export const SESSION_COOKIE = 'wave_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

interface SessionPayload {
  userId: string;
  businessId: string;
  /** Unix seconds. */
  exp: number;
}

function signingKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set.');
  return createHmac('sha256', Buffer.from(raw, 'base64')).update('session-signing').digest();
}

export function signSession(payload: Omit<SessionPayload, 'exp'>): string {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const mac = createHmac('sha256', signingKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifySession(token: string): SessionPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', signingKey()).update(body).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(mac, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
    if (typeof payload.userId !== 'string' || typeof payload.businessId !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
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
const ROLE_RANK: Record<MembershipRole, number> = {
  OWNER: 3,
  ACCOUNTANT: 2,
  EMPLOYEE: 1,
  CONTRACTOR_VIEW: 0,
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
