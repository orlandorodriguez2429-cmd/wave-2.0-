// Plaid webhook verification + handling.
//
// Verification (https://plaid.com/docs/api/webhooks/webhook-verification/):
//   1. The Plaid-Verification header is a JWT; its header must say alg=ES256
//      and carry a key id (kid).
//   2. Fetch that public key with /webhook_verification_key/get (cached by
//      kid) and reject expired keys.
//   3. Verify the ES256 signature over "<header>.<payload>".
//   4. Reject if the token's iat is more than 5 minutes old.
//   5. SHA-256 the raw request body and compare (constant time) with the
//      token's request_body_sha256.
// Anything that fails → reject. Uses Node's crypto; no extra JWT library.
import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';
import { prisma } from '@/lib/db';
import { plaidClient, safePlaidError } from './plaid-client';

export interface VerificationKey extends JsonWebKey {
  kid: string;
  alg: string;
  expired_at: number | null;
}

export type KeyFetcher = (kid: string) => Promise<VerificationKey | null>;

const MAX_AGE_SECONDS = 5 * 60;

const keyCache = new Map<string, VerificationKey>();

/** Default fetcher: Plaid's /webhook_verification_key/get, cached per kid. */
export const fetchPlaidKey: KeyFetcher = async (kid) => {
  const hit = keyCache.get(kid);
  if (hit && hit.expired_at === null) return hit;
  try {
    const { data } = await plaidClient().webhookVerificationKeyGet({ key_id: kid });
    const key = data.key as unknown as VerificationKey;
    keyCache.set(kid, key);
    return key;
  } catch (err) {
    // Unknown kid or Plaid unreachable: can't verify → reject.
    console.warn(safePlaidError('webhook key get', err).message);
    return null;
  }
};

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export async function verifyPlaidWebhook(
  rawBody: string,
  token: string | null,
  fetchKey: KeyFetcher = fetchPlaidKey,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;

  const header = b64urlJson(h);
  if (!header || header.alg !== 'ES256' || typeof header.kid !== 'string') return false;

  const key = await fetchKey(header.kid);
  if (!key || key.expired_at !== null) return false;

  let ok: boolean;
  try {
    const publicKey = createPublicKey({ key: key as JsonWebKey, format: 'jwk' });
    ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  } catch {
    return false;
  }
  if (!ok) return false;

  const payload = b64urlJson(p);
  if (!payload || typeof payload.iat !== 'number' || typeof payload.request_body_sha256 !== 'string') return false;
  if (nowSeconds - payload.iat > MAX_AGE_SECONDS || payload.iat - nowSeconds > 60) return false;

  const actual = createHash('sha256').update(rawBody, 'utf8').digest();
  let claimed: Buffer;
  try {
    claimed = Buffer.from(payload.request_body_sha256, 'hex');
  } catch {
    return false;
  }
  return claimed.length === actual.length && timingSafeEqual(claimed, actual);
}

// --- Handling -----------------------------------------------------------------

export interface PlaidWebhookBody {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string } | null;
}

/** ITEM webhooks that mean the client must re-run Link in update mode. */
const NEEDS_RECONNECT_CODES = new Set([
  'ERROR',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
  'USER_PERMISSION_REVOKED',
  'USER_ACCOUNT_REVOKED',
]);

export type WebhookOutcome =
  | { action: 'ignored' }
  | { action: 'sync'; connectionId: string }
  | { action: 'status'; connectionId: string; status: 'ACTIVE' | 'NEEDS_RECONNECT' };

/**
 * Apply a VERIFIED webhook to our state. Returns what the caller should do
 * next (the route runs the sync after responding). Audit-logged as a system
 * action; payload holds only type/code/error_code.
 */
export async function applyPlaidWebhook(body: PlaidWebhookBody): Promise<WebhookOutcome> {
  if (!body.item_id || !body.webhook_type || !body.webhook_code) return { action: 'ignored' };
  const connection = await prisma.bankConnection.findUnique({ where: { itemId: body.item_id } });
  if (!connection || connection.status === 'REMOVED') return { action: 'ignored' };

  const type = body.webhook_type;
  const code = body.webhook_code;
  const errorCode = body.error?.error_code ?? null;
  const now = new Date();
  let outcome: WebhookOutcome = { action: 'ignored' };

  if (type === 'TRANSACTIONS' && code === 'SYNC_UPDATES_AVAILABLE') {
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { lastWebhookAt: now, syncRequestedAt: now },
    });
    outcome = { action: 'sync', connectionId: connection.id };
  } else if (type === 'ITEM' && (code === 'ITEM_LOGIN_REQUIRED' || NEEDS_RECONNECT_CODES.has(code))) {
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { lastWebhookAt: now, status: 'NEEDS_RECONNECT', errorCode: errorCode ?? code },
    });
    outcome = { action: 'status', connectionId: connection.id, status: 'NEEDS_RECONNECT' };
  } else if (type === 'ITEM' && code === 'LOGIN_REPAIRED') {
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { lastWebhookAt: now, status: 'ACTIVE', errorCode: null, syncRequestedAt: now },
    });
    outcome = { action: 'sync', connectionId: connection.id };
  } else {
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { lastWebhookAt: now } });
  }

  await prisma.auditLog.create({
    data: {
      businessId: connection.businessId,
      userId: null,
      action: 'bank_connection.webhook',
      entityType: 'bank_connection',
      entityId: connection.id,
      payload: { type, code, ...(errorCode ? { errorCode } : {}), outcome: outcome.action },
    },
  });
  return outcome;
}
