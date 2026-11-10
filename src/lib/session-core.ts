// Signed session tokens using Web Crypto, so the SAME code runs in the
// middleware (edge runtime) and on the server. Format:
//   base64url(JSON payload) "." base64url(HMAC-SHA256(key, payload))
// key = HMAC-SHA256(ENCRYPTION_KEY bytes, "session-signing").
// The payload holds ids and timestamps only — nothing secret.

export type SessionRole = 'OWNER' | 'ACCOUNTANT' | 'EMPLOYEE' | 'CONTRACTOR_VIEW' | 'CLIENT';

export interface SessionPayload {
  kind: 'session';
  userId: string;
  businessId: string;
  role: SessionRole;
  /** users.sessionVersion at sign-in; a bump kills this session. */
  sv: number;
  /** Unix seconds. */
  iat: number;
  lastActive: number;
  exp: number;
}

/** Between password and MFA: proves the password step only. */
export interface PendingMfaPayload {
  kind: 'pending-mfa';
  userId: string;
  /** "verify" = has MFA; "enroll" = must set it up now. */
  stage: 'verify' | 'enroll';
  /** Where to land afterwards (e.g. a business chosen by an invite). */
  businessId?: string;
  iat: number;
  exp: number;
}

export type TokenPayload = SessionPayload | PendingMfaPayload;

/** Staff are signed out after 30 idle minutes; clients after 2 hours. */
export const STAFF_IDLE_SECONDS = 30 * 60;
export const CLIENT_IDLE_SECONDS = 2 * 60 * 60;
/** Absolute session lifetime regardless of activity. */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;
export const PENDING_MFA_SECONDS = 10 * 60;
/** Don't re-sign the cookie more often than this. */
export const REFRESH_AFTER_SECONDS = 60;

export const isProd = () => process.env.NODE_ENV === 'production';
// __Host- prefix: browser enforces Secure, Path=/ and no Domain (prod only;
// plain http://localhost can't use it).
export const sessionCookieName = () => (isProd() ? '__Host-yts_session' : 'yts_session');
export const pendingCookieName = () => (isProd() ? '__Host-yts_mfa' : 'yts_mfa');

export function cookieOptions(maxAgeSeconds: number) {
  return { httpOnly: true, secure: isProd(), sameSite: 'lax' as const, path: '/', maxAge: maxAgeSeconds };
}

const enc = new TextEncoder();
let cachedKey: { raw: string; key: CryptoKey } | null = null;

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signingKey(): Promise<CryptoKey> {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set.');
  if (cachedKey?.raw === raw) return cachedKey.key;
  const master = await crypto.subtle.importKey('raw', b64urlDecode(raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = new Uint8Array(await crypto.subtle.sign('HMAC', master, enc.encode('session-signing')));
  const key = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cachedKey = { raw, key };
  return key;
}

export async function signToken(payload: TokenPayload): Promise<string> {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(), enc.encode(body)));
  return `${body}.${b64urlEncode(mac)}`;
}

export async function verifyToken(token: string | undefined | null): Promise<TokenPayload | null> {
  if (!token) return null;
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = b64urlDecode(mac);
  } catch {
    return null;
  }
  // crypto.subtle.verify is constant-time.
  const ok = await crypto.subtle.verify('HMAC', await signingKey(), sig, enc.encode(body));
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as TokenPayload;
  } catch {
    return null;
  }
}

/** Valid, unexpired, not idle too long. */
export function sessionIsLive(p: TokenPayload | null, nowSeconds = Math.floor(Date.now() / 1000)): p is SessionPayload {
  if (!p || p.kind !== 'session') return false;
  if (typeof p.userId !== 'string' || typeof p.businessId !== 'string') return false;
  if (p.exp < nowSeconds) return false;
  const idle = p.role === 'CLIENT' ? CLIENT_IDLE_SECONDS : STAFF_IDLE_SECONDS;
  return nowSeconds - p.lastActive <= idle;
}

export function newSession(opts: { userId: string; businessId: string; role: SessionRole; sv: number }, now = Math.floor(Date.now() / 1000)): SessionPayload {
  return { kind: 'session', ...opts, iat: now, lastActive: now, exp: now + MAX_SESSION_SECONDS };
}
