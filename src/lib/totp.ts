// TOTP (RFC 6238 / RFC 4226): 6 digits, 30-second steps, HMAC-SHA1 — what
// Google Authenticator, Microsoft Authenticator, 1Password, Authy etc. use.
// Node's crypto only; no third-party OTP library.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random secret (160 bits), base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/**
 * Check a code, allowing one step of clock drift either way. Returns the
 * matched step (store it and reject codes at or before it: no replay), or null.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { nowMs?: number; lastStep?: number | null } = {}): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = currentStep(opts.nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

export function otpauthUrl(secretBase32: string, accountLabel: string, issuer = 'Your Tax Solution Books'): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// --- Backup codes ----------------------------------------------------------------

/** Ten one-time codes like "k7m2-9xqp-4tvw" (~60 bits each). */
export function generateBackupCodes(count = 10): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(12);
    const raw = Array.from(bytes, (b) => chars[b % chars.length]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.trim().toLowerCase().replace(/\s/g, '')).digest('hex');
}
