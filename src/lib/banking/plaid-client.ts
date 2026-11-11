// Plaid SDK configuration — env vars only, never the repo.
//   PLAID_CLIENT_ID, PLAID_SECRET  — from dashboard.plaid.com (per environment)
//   PLAID_ENV                      — "sandbox" | "production"
//   PLAID_WEBHOOK_URL              — public HTTPS URL of /api/plaid/webhook
// Without CLIENT_ID + SECRET the app runs on the mock provider.
//
// SECURITY: errors thrown by the SDK carry the request config, which includes
// the PLAID-SECRET header. Never log or rethrow a raw SDK error — use
// plaidErrorCode() / safePlaidError() instead.
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid/legacy';

export type PlaidEnv = 'sandbox' | 'production';

export interface PlaidConfig {
  clientId: string;
  secret: string;
  env: PlaidEnv;
  webhookUrl: string | null;
}

export function plaidConfig(): PlaidConfig | null {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  if (!clientId || !secret) return null;
  const env = (process.env.PLAID_ENV?.trim() || 'sandbox') as PlaidEnv;
  if (env !== 'sandbox' && env !== 'production') {
    throw new Error('PLAID_ENV must be "sandbox" or "production".');
  }
  const webhookUrl = process.env.PLAID_WEBHOOK_URL?.trim() || null;
  return { clientId, secret, env, webhookUrl };
}

export function isPlaidConfigured(): boolean {
  return plaidConfig() !== null;
}

let cached: { key: string; client: PlaidApi } | null = null;

export function plaidClient(): PlaidApi {
  const config = plaidConfig();
  if (!config) throw new Error('Plaid is not configured (PLAID_CLIENT_ID / PLAID_SECRET).');
  const key = `${config.env}:${config.clientId}`;
  if (cached?.key === key) return cached.client;
  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.env],
      baseOptions: {
        headers: { 'PLAID-CLIENT-ID': config.clientId, 'PLAID-SECRET': config.secret },
        timeout: 30_000,
      },
    }),
  );
  cached = { key, client };
  return client;
}

/** Plaid's error_code from an SDK error (e.g. "ITEM_LOGIN_REQUIRED"), or null. */
export function plaidErrorCode(err: unknown): string | null {
  const data = (err as { response?: { data?: { error_code?: unknown } } })?.response?.data;
  return typeof data?.error_code === 'string' ? data.error_code : null;
}

/** A loggable/throwable error that carries only Plaid's error code. */
export class PlaidRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | null,
  ) {
    super(`Plaid ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'PlaidRequestError';
  }
}

export function safePlaidError(operation: string, err: unknown): PlaidRequestError {
  return new PlaidRequestError(operation, plaidErrorCode(err));
}

/** Error codes that mean the bank login must be repaired through Link update mode. */
export const RECONNECT_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
  'ITEM_LOCKED',
  'INVALID_UPDATED_USERNAME',
  'USER_PERMISSION_REVOKED',
  'ACCESS_NOT_GRANTED',
]);
