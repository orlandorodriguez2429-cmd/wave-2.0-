// MFA enrollment and verification (TOTP + one-time backup codes).
import { prisma } from '@/lib/db';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { generateBackupCodes, generateTotpSecret, hashBackupCode, verifyTotp } from '@/lib/totp';

/** The secret to show while enrolling (created on first call, not yet active). */
export async function enrollmentSecret(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabledAt) throw new Error('MFA is already set up.');
  if (user.mfaSecretEncrypted) return decryptSecret(user.mfaSecretEncrypted);
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: encryptSecret(secret) } });
  return secret;
}

/** Confirm enrollment with a first code; returns the backup codes (shown once). */
export async function confirmEnrollment(userId: string, code: string, nowMs = Date.now()): Promise<string[] | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabledAt || !user.mfaSecretEncrypted) return null;
  const step = verifyTotp(decryptSecret(user.mfaSecretEncrypted), code, { nowMs });
  if (step === null) return null;
  const codes = generateBackupCodes();
  await prisma.$transaction([
    prisma.mfaBackupCode.deleteMany({ where: { userId } }),
    prisma.mfaBackupCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashBackupCode(c) })) }),
    prisma.user.update({
      where: { id: userId },
      // Credential change: any other session of this user dies.
      data: { mfaEnabledAt: new Date(nowMs), mfaLastStep: step, sessionVersion: { increment: 1 } },
    }),
  ]);
  return codes;
}

/** Verify a login code: a TOTP code (no replay) or an unused backup code. */
export async function verifyLoginCode(userId: string, code: string, nowMs = Date.now()): Promise<'totp' | 'backup' | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaEnabledAt || !user.mfaSecretEncrypted) return null;
  const clean = code.trim();
  if (/^\d{6}$/.test(clean.replace(/\s/g, ''))) {
    const step = verifyTotp(decryptSecret(user.mfaSecretEncrypted), clean, { nowMs, lastStep: user.mfaLastStep });
    if (step === null) return null;
    // Conditional update so two parallel requests can't both use one code.
    const res = await prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step },
    });
    return res.count === 1 ? 'totp' : null;
  }
  const res = await prisma.mfaBackupCode.updateMany({
    where: { userId, codeHash: hashBackupCode(clean), usedAt: null },
    data: { usedAt: new Date(nowMs) },
  });
  return res.count === 1 ? 'backup' : null;
}

/** Owner resets a member's MFA (lost phone): they must enroll again at next login. */
export async function resetMfa(userId: string) {
  await prisma.$transaction([
    prisma.mfaBackupCode.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: null, mfaEnabledAt: null, mfaLastStep: null, sessionVersion: { increment: 1 } },
    }),
  ]);
}
