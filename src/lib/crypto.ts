// AES-256-GCM encryption for secrets at rest (bank access tokens now, TINs in
// Phase 4). Key comes from ENCRYPTION_KEY: 32 bytes, base64. Ciphertext format
// "v1:<iv b64>:<tag b64>:<data b64>" so the scheme can rotate later.
// NEVER log plaintext or ciphertext; redact in errors.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set (32 random bytes, base64). Refusing to store secrets.');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(ciphertext: string): string {
  const [version, ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Unrecognized ciphertext format.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Mask all but the last `visible` characters: "***-**-1234". */
export function maskTail(value: string, visible = 4): string {
  const tail = value.slice(-visible);
  return `***${tail.length < value.length ? '…' : ''}${tail}`;
}
