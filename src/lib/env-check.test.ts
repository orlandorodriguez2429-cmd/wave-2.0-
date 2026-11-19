import { describe, expect, it } from 'vitest';
import { productionEnvProblems } from './env-check';

const good = {
  NODE_ENV: 'production',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  PLAID_CLIENT_ID: 'id',
  PLAID_SECRET: 'secret',
  PLAID_ENV: 'production',
  PLAID_WEBHOOK_URL: 'https://books.example.com/api/plaid/webhook',
  CRON_SECRET: 'x'.repeat(40),
  APP_URL: 'https://books.example.com',
};

describe('productionEnvProblems', () => {
  it('passes a complete production config', () => expect(productionEnvProblems(good)).toEqual([]));
  it('ignores development', () => expect(productionEnvProblems({ NODE_ENV: 'development' })).toEqual([]));
  it.each(['ENCRYPTION_KEY', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV', 'PLAID_WEBHOOK_URL', 'CRON_SECRET', 'APP_URL'])('refuses without %s', (k) => {
    expect(productionEnvProblems({ ...good, [k]: undefined }).join(' ')).toContain(k);
  });
  it('refuses a short key and the public dev key', () => {
    expect(productionEnvProblems({ ...good, ENCRYPTION_KEY: 'c2hvcnQ=' })[0]).toMatch(/32 random bytes/);
    expect(productionEnvProblems({ ...good, ENCRYPTION_KEY: '3Jze7fSYxvxXRtj1PWp3e3Mv7Xv7KvXGGzXieeNIFEk=' })[0]).toMatch(/public development key/);
  });
  it('LOCAL_DEMO allows running without Plaid/cron, but still needs a real key', () => {
    expect(productionEnvProblems({ NODE_ENV: 'production', LOCAL_DEMO: 'true', ENCRYPTION_KEY: good.ENCRYPTION_KEY })).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: 'production', LOCAL_DEMO: 'true' })).toEqual(['ENCRYPTION_KEY is not set.']);
  });
});
