import { describe, expect, it } from 'vitest';
import { oauthRedirectUri } from './plaid';

describe('Plaid OAuth redirect URI', () => {
  const env = { APP_URL: 'https://yts-books.onrender.com/', PLAID_OAUTH_REDIRECT: 'true' };
  it('is off unless PLAID_OAUTH_REDIRECT=true (unregistered URIs break Link)', () => {
    expect(oauthRedirectUri('staff', { APP_URL: env.APP_URL })).toBeUndefined();
  });
  it('points staff and clients at their own return pages', () => {
    expect(oauthRedirectUri('staff', env)).toBe('https://yts-books.onrender.com/plaid-oauth');
    expect(oauthRedirectUri('client', env)).toBe('https://yts-books.onrender.com/client/plaid-oauth');
  });
  it('needs an https APP_URL', () => {
    expect(oauthRedirectUri('staff', { ...env, APP_URL: 'http://localhost:3000' })).toBeUndefined();
  });
});
