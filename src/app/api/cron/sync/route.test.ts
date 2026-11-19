import { afterEach, describe, expect, it, vi } from 'vitest';

const syncAll = vi.fn(async () => ({ connections: 2, ok: 2, failed: 0, imported: 3, autoCategorized: 2, skippedNeedsReconnect: 0 }));
vi.mock('@/lib/banking/sync-all', () => ({ syncAllConnections: syncAll }));
const { POST } = await import('./route');

const call = (headers: Record<string, string> = {}) => POST(new Request('http://x/api/cron/sync', { method: 'POST', headers }));

describe('POST /api/cron/sync', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    syncAll.mockClear();
  });
  it('503s when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call({ authorization: 'Bearer x' })).status).toBe(503);
  });
  it('401s without the right secret', async () => {
    vi.stubEnv('CRON_SECRET', 'a-long-enough-secret-value');
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: 'Bearer wrong-secret-value-123' })).status).toBe(401);
    expect(syncAll).not.toHaveBeenCalled();
  });
  it('runs with Bearer or X-Cron-Secret', async () => {
    vi.stubEnv('CRON_SECRET', 'a-long-enough-secret-value');
    const r = await call({ authorization: 'Bearer a-long-enough-secret-value' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ success: true, imported: 3 });
    expect((await call({ 'x-cron-secret': 'a-long-enough-secret-value' })).status).toBe(200);
  });
});
