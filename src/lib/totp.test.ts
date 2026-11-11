import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateBackupCodes, hashBackupCode, totpAt, verifyTotp } from './totp';

// RFC 6238 Appendix B test secret ("12345678901234567890"), SHA-1, 8 digits;
// we use the low 6 digits of the published values.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(Buffer.from('hello world'))).toString()).toBe('hello world');
  });
  it('matches RFC 6238 vectors', () => {
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('accepts ±1 step of drift and rejects replays', () => {
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30000);
    const code = totpAt(RFC_SECRET, step - 1);
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastStep: step - 1 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', { nowMs: now })).toBeNull();
  });
  it('makes distinct backup codes and hashes them case-insensitively', () => {
    const codes = generateBackupCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(hashBackupCode(codes[0].toUpperCase())).toBe(hashBackupCode(codes[0]));
  });
});
