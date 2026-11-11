// Invites (single use, hashed, 72 h, one business per client), MFA (TOTP +
// backup codes, no replay), rate limits and lockout.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { createBusiness } from '@/lib/ledger/business';
import { acceptInvite, createInvite, findInvite, hashToken } from './invites';
import { confirmEnrollment, enrollmentSecret, resetMfa, verifyLoginCode } from './mfa';
import { totpAt } from './totp';
import { hit, isLocked, LOCKOUT_THRESHOLD, recordFailure, recordSuccess } from './rate-limit';

const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let ownerId: string;
let bizA: string;
let bizB: string;
const sent: string[] = [];

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation((m: unknown) => void sent.push(String(m)));
  ownerId = (await prisma.user.create({ data: { email: `owner-${tag}@t.local`, name: 'Owner' } })).id;
  bizA = (await createBusiness({ userId: ownerId, name: 'Invite A' })).id;
  bizB = (await createBusiness({ userId: ownerId, name: 'Invite B' })).id;
});
afterAll(async () => prisma.$disconnect());

const linkToken = (link: string) => link.split('/invite/')[1];

describe('invites', () => {
  const email = `newclient-${tag}@t.local`;
  let token: string;

  it('emails a link and stores only a hash of the token', async () => {
    const { inviteId, link } = await createInvite({ businessId: bizA, invitedById: ownerId, email });
    token = linkToken(link);
    const row = await prisma.invite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeCloseTo(72 * 3600_000, -4);
    expect(sent.join('\n')).toContain(link);
  });

  it('requires a 12+ character password, then works exactly once', async () => {
    await expect(acceptInvite({ token, password: 'short' })).rejects.toThrow(/at least 12/);
    const r = await acceptInvite({ token, name: 'Pat Client', password: 'correct horse battery' });
    expect(r.businessId).toBe(bizA);
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: r.userId } });
    expect(m.role).toBe('CLIENT');
    await expect(acceptInvite({ token, password: 'correct horse battery' })).rejects.toThrow(/not valid/);
    expect((await findInvite(token)).problem).toBe('used');
  });

  it('a client login can never be given a second business', async () => {
    await expect(createInvite({ businessId: bizB, invitedById: ownerId, email })).rejects.toThrow(/another business/);
  });

  it('expired, replaced and garbage links are refused', async () => {
    const e2 = `late-${tag}@t.local`;
    const first = linkToken((await createInvite({ businessId: bizA, invitedById: ownerId, email: e2, now: new Date(Date.now() - 73 * 3600_000) })).link);
    expect((await findInvite(first)).problem).toBe('expired');
    const second = linkToken((await createInvite({ businessId: bizA, invitedById: ownerId, email: e2 })).link);
    const third = linkToken((await createInvite({ businessId: bizA, invitedById: ownerId, email: e2 })).link);
    expect((await findInvite(second)).problem).toBe('revoked');
    expect((await findInvite(third)).problem).toBeNull();
    expect((await findInvite('../../etc')).problem).toBe('invalid');
  });
});

describe('MFA', () => {
  let userId: string;
  let secret: string;
  const t0 = Date.UTC(2026, 10, 10, 12, 0, 0);
  const step = Math.floor(t0 / 30000);

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `mfa-${tag}@t.local`, name: 'M' } })).id;
  });

  it('enrolls with a current code, returns 10 backup codes, stores the secret encrypted', async () => {
    secret = await enrollmentSecret(userId);
    expect(await confirmEnrollment(userId, '000000', t0)).toBeNull();
    const codes = await confirmEnrollment(userId, totpAt(secret, step), t0);
    expect(codes).toHaveLength(10);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.mfaEnabledAt).not.toBeNull();
    expect(u.mfaSecretEncrypted).not.toContain(secret);
    expect(await prisma.mfaBackupCode.count({ where: { userId } })).toBe(10);
    (globalThis as { __codes?: string[] }).__codes = codes!;
  });

  it('accepts the next code once, never the same one twice', async () => {
    const next = totpAt(secret, step + 1);
    expect(await verifyLoginCode(userId, next, t0 + 30_000)).toBe('totp');
    expect(await verifyLoginCode(userId, next, t0 + 30_000)).toBeNull();
    expect(await verifyLoginCode(userId, totpAt(secret, step), t0 + 30_000)).toBeNull(); // older step
  });

  it('backup codes work once each', async () => {
    const [code] = (globalThis as { __codes?: string[] }).__codes!;
    expect(await verifyLoginCode(userId, code.toUpperCase(), t0)).toBe('backup');
    expect(await verifyLoginCode(userId, code, t0)).toBeNull();
  });

  it('reset clears MFA and ends sessions', async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;
    await resetMfa(userId);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect([u.mfaEnabledAt, u.mfaSecretEncrypted]).toEqual([null, null]);
    expect(u.sessionVersion).toBe(before + 1);
    expect(await prisma.mfaBackupCode.count({ where: { userId } })).toBe(0);
  });
});

describe('rate limits & lockout', () => {
  it('allows up to the limit per window, then refuses until the window passes', async () => {
    const key = `test:${tag}`;
    const limit = { max: 3, windowSeconds: 60 };
    const t = new Date('2026-11-10T12:00:00Z');
    expect([await hit(key, limit, t), await hit(key, limit, t), await hit(key, limit, t)]).toEqual([true, true, true]);
    expect(await hit(key, limit, t)).toBe(false);
    expect(await hit(key, limit, new Date(t.getTime() + 61_000))).toBe(true);
  });

  it(`locks an account after ${LOCKOUT_THRESHOLD} failures`, async () => {
    const id = (await prisma.user.create({ data: { email: `lock-${tag}@t.local`, name: 'L' } })).id;
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) await recordFailure(id);
    expect(isLocked(await prisma.user.findUniqueOrThrow({ where: { id } }))).toBe(false);
    await recordFailure(id);
    expect(isLocked(await prisma.user.findUniqueOrThrow({ where: { id } }))).toBe(true);
    await recordSuccess(id);
    expect(isLocked(await prisma.user.findUniqueOrThrow({ where: { id } }))).toBe(false);
  });
});

describe('password reset', () => {
  it('emails a hashed single-use link, ends sessions and clears lockout, says nothing about unknown emails', async () => {
    const { requestPasswordReset, resetPassword, checkResetToken } = await import('./password-reset');
    const { verifyPassword, hashPassword } = await import('./auth');
    const email = `reset-${tag}@t.local`;
    const user = await prisma.user.create({
      data: { email, name: 'R', passwordHash: await hashPassword('old-password-123'), lockedUntil: new Date(Date.now() + 600_000), failedLoginCount: 4 },
    });
    await prisma.membership.create({ data: { userId: user.id, businessId: bizA, role: 'ACCOUNTANT' } });

    expect(await requestPasswordReset(`nobody-${tag}@t.local`)).toEqual({});
    const first = await requestPasswordReset(email);
    const second = await requestPasswordReset(email);
    const t1 = first.link!.split('/reset/')[1];
    const t2 = second.link!.split('/reset/')[1];
    expect(await checkResetToken(t1)).toBeNull(); // replaced by the newer one
    expect(JSON.stringify(await prisma.passwordReset.findMany({ where: { userId: user.id } }))).not.toContain(t2);

    await expect(resetPassword(t2, 'short')).rejects.toThrow(/at least 12/);
    await resetPassword(t2, 'brand-new-password-456');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword('brand-new-password-456', after.passwordHash!)).toBe(true);
    expect(after.sessionVersion).toBe(user.sessionVersion + 1);
    expect([after.lockedUntil, after.failedLoginCount]).toEqual([null, 0]);
    await expect(resetPassword(t2, 'another-password-789')).rejects.toThrow(/not valid/);

    const old = await requestPasswordReset(email, new Date(Date.now() - 61 * 60_000));
    expect(await checkResetToken(old.link!.split('/reset/')[1])).toBeNull(); // expired
  });
});

describe('first-run setup', () => {
  it('needs the setup code and an empty database', async () => {
    const { runSetup, setupAvailable } = await import('./setup');
    vi.stubEnv('SETUP_CODE', 'correct-setup-code');
    // The shared test database already has users, so setup must refuse.
    expect(await setupAvailable()).toBe(false);
    await expect(runSetup({ code: 'wrong', name: 'A', email: 'a@b.co', businessName: 'X', password: 'long-enough-password' })).rejects.toThrow(/not right/);
    await expect(runSetup({ code: 'correct-setup-code', name: 'A', email: 'a@b.co', businessName: 'X', password: 'long-enough-password' })).rejects.toThrow(/already completed/);
    vi.stubEnv('SETUP_CODE', '');
    expect(await setupAvailable()).toBe(false);
    vi.unstubAllEnvs();
  });
});
