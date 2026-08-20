import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';

// Bearer-token auth for the developer API. Tokens look like
// "wave_<48 hex chars>"; only the SHA-256 hash is stored.

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return `wave_${randomBytes(24).toString('hex')}`;
}

export async function resolveApiToken(authorization: string | null) {
  const match = /^Bearer\s+(wave_[a-f0-9]{48})$/.exec(authorization ?? '');
  if (!match) return null;
  const token = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(match[1]) } });
  if (!token || token.revokedAt) return null;
  await prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  return token;
}
