// The webhook endpoint is public; anything without a valid Plaid signature
// must be rejected before it touches the database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apply = vi.fn();
vi.mock('@/lib/banking/plaid-webhook', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/banking/plaid-webhook')>()),
  applyPlaidWebhook: apply,
}));
const { POST } = await import('./route');

const body = JSON.stringify({ webhook_type: 'ITEM', webhook_code: 'ERROR', item_id: 'item_x' });
const post = (headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost/api/plaid/webhook', { method: 'POST', body, headers }));

describe('POST /api/plaid/webhook', () => {
  beforeEach(() => {
    vi.stubEnv('PLAID_CLIENT_ID', 'test-client');
    vi.stubEnv('PLAID_SECRET', 'test-secret');
    vi.stubEnv('PLAID_ENV', 'sandbox');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    apply.mockReset();
  });

  it('404s when Plaid is not configured', async () => {
    vi.stubEnv('PLAID_CLIENT_ID', '');
    expect((await post()).status).toBe(404);
  });
  it('401s without a Plaid-Verification header', async () => {
    expect((await post()).status).toBe(401);
    expect(apply).not.toHaveBeenCalled();
  });
  it('401s with a forged header', async () => {
    const forged = `${Buffer.from('{"alg":"none","kid":"k"}').toString('base64url')}.e30.`;
    expect((await post({ 'plaid-verification': forged })).status).toBe(401);
    expect(apply).not.toHaveBeenCalled();
  });
});
