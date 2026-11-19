// Fixed-window rate limiting in Postgres (works across app instances; no
// Redis needed at this scale). One row per key.
import { prisma } from '@/lib/db';

export interface Limit {
  /** Max attempts per window. */
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  loginPerIp: { max: 20, windowSeconds: 15 * 60 },
  loginPerEmail: { max: 8, windowSeconds: 15 * 60 },
  mfaPerUser: { max: 6, windowSeconds: 10 * 60 },
  invitePerIp: { max: 20, windowSeconds: 60 * 60 },
  inviteSendPerBusiness: { max: 30, windowSeconds: 60 * 60 },
} satisfies Record<string, Limit>;

/** Count one attempt; returns false once the key is over its limit. */
export async function hit(key: string, limit: Limit, now = new Date()): Promise<boolean> {
  const windowStartMin = new Date(now.getTime() - limit.windowSeconds * 1000);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_buckets" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_buckets"."windowStart" < ${windowStartMin} THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
      "windowStart" = CASE WHEN "rate_limit_buckets"."windowStart" < ${windowStartMin} THEN ${now} ELSE "rate_limit_buckets"."windowStart" END
    RETURNING "count"`;
  return (rows[0]?.count ?? 1) <= limit.max;
}

export async function resetLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}

// --- Account lockout -------------------------------------------------------------

export const LOCKOUT_THRESHOLD = 10;
export const LOCKOUT_MINUTES = 15;

export function isLocked(user: { lockedUntil: Date | null }, now = new Date()): boolean {
  return !!user.lockedUntil && user.lockedUntil > now;
}

/** Record a failed password or MFA attempt; locks the account at the threshold. */
export async function recordFailure(userId: string, now = new Date()) {
  const u = await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: { increment: 1 } } });
  if (u.failedLoginCount >= LOCKOUT_THRESHOLD) {
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000), failedLoginCount: 0 },
    });
  }
}

export async function recordSuccess(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
}
