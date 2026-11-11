// Webhook verification with a locally generated ES256 key standing in for
// Plaid's /webhook_verification_key/get.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyPlaidWebhook, type KeyFetcher, type VerificationKey } from './plaid-webhook';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', alg: 'ES256', use: 'sig', created_at: 1, expired_at: null } as VerificationKey;
const fetchKey: KeyFetcher = async (kid) => (kid === 'kid-1' ? jwk : null);

const NOW = 1_800_000_000;
const BODY = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'item_1' }, null, 2);

function token(opts: { body?: string; iat?: number; alg?: string; kid?: string; key?: typeof privateKey } = {}) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = enc({ alg: opts.alg ?? 'ES256', kid: opts.kid ?? 'kid-1', typ: 'JWT' });
  const payload = enc({
    iat: opts.iat ?? NOW,
    request_body_sha256: createHash('sha256').update(opts.body ?? BODY).digest('hex'),
  });
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key: opts.key ?? privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${sig.toString('base64url')}`;
}

describe('verifyPlaidWebhook', () => {
  it('accepts a correctly signed, fresh webhook', async () => {
    expect(await verifyPlaidWebhook(BODY, token(), fetchKey, NOW + 10)).toBe(true);
  });
  it('rejects a missing or malformed header', async () => {
    expect(await verifyPlaidWebhook(BODY, null, fetchKey, NOW)).toBe(false);
    expect(await verifyPlaidWebhook(BODY, 'abc.def', fetchKey, NOW)).toBe(false);
  });
  it('rejects a tampered body (hash mismatch), including whitespace changes', async () => {
    expect(await verifyPlaidWebhook(BODY.replace('item_1', 'item_2'), token(), fetchKey, NOW)).toBe(false);
    expect(await verifyPlaidWebhook(JSON.stringify(JSON.parse(BODY)), token(), fetchKey, NOW)).toBe(false);
  });
  it('rejects a signature from a different key', async () => {
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(await verifyPlaidWebhook(BODY, token({ key: other }), fetchKey, NOW)).toBe(false);
  });
  it('rejects tokens older than 5 minutes', async () => {
    expect(await verifyPlaidWebhook(BODY, token({ iat: NOW - 301 }), fetchKey, NOW)).toBe(false);
  });
  it('rejects any algorithm other than ES256 (incl. "none")', async () => {
    expect(await verifyPlaidWebhook(BODY, token({ alg: 'none' }), fetchKey, NOW)).toBe(false);
    expect(await verifyPlaidWebhook(BODY, token({ alg: 'HS256' }), fetchKey, NOW)).toBe(false);
  });
  it('rejects unknown and expired keys', async () => {
    expect(await verifyPlaidWebhook(BODY, token({ kid: 'nope' }), fetchKey, NOW)).toBe(false);
    const expired: KeyFetcher = async () => ({ ...jwk, expired_at: NOW - 1 });
    expect(await verifyPlaidWebhook(BODY, token(), expired, NOW)).toBe(false);
  });
});
