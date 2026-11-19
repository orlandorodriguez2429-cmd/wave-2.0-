import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, encryptionKeyBytes } from './crypto';

const original = process.env.ENCRYPTION_KEY;
afterEach(() => {
  process.env.ENCRYPTION_KEY = original;
});

describe('encryption key', () => {
  it('uses a 32-byte base64 key as-is', () => {
    const b64 = Buffer.alloc(32, 9).toString('base64');
    expect(encryptionKeyBytes(b64)).toEqual(Buffer.alloc(32, 9));
  });
  it('hashes a long random string (dashboard "Generate" value) to 32 bytes', () => {
    const k = encryptionKeyBytes('7b175d88325f651ed9dd7f9df76ccffa');
    expect(k?.length).toBe(32);
    process.env.ENCRYPTION_KEY = '7b175d88325f651ed9dd7f9df76ccffa';
    expect(decryptSecret(encryptSecret('hello'))).toBe('hello');
  });
  it('refuses short or missing keys', () => {
    expect(encryptionKeyBytes('short')).toBeNull();
    expect(encryptionKeyBytes('')).toBeNull();
    process.env.ENCRYPTION_KEY = 'short';
    expect(() => encryptSecret('x')).toThrow(/at least 32 characters/);
  });
});
