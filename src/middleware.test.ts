// Route fencing for every page and route handler in the app, enumerated from
// the filesystem so a new staff page can't be forgotten.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware, isPublicPath } from './middleware';
import { newSession, signToken, sessionCookieName, STAFF_IDLE_SECONDS } from './lib/session-core';

function routes(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      const seg = name.startsWith('[') ? 'x1' : name; // dynamic segment → dummy id
      out.push(...routes(full, `${base}/${seg}`));
    } else if (name === 'page.tsx' || name === 'route.ts') {
      out.push(base || '/');
    }
  }
  return [...new Set(out)];
}

const ALL = routes(path.join(__dirname, 'app'));
const PORTAL = ALL.filter((r) => r === '/client' || r.startsWith('/client/'));
const PUBLIC = ALL.filter((r) => isPublicPath(r));
const STAFF = ALL.filter((r) => !PORTAL.includes(r) && !PUBLIC.includes(r));

async function request(p: string, role: 'CLIENT' | 'OWNER' | null, opts: { idle?: boolean; method?: string } = {}) {
  const headers: Record<string, string> = {};
  if (role) {
    const now = Math.floor(Date.now() / 1000);
    const s = newSession({ userId: 'u1', businessId: 'b1', role, sv: 1 }, opts.idle ? now - STAFF_IDLE_SECONDS - 60 : now);
    headers.cookie = `${sessionCookieName()}=${await signToken(s)}`;
  }
  return middleware(new NextRequest(`http://localhost${p}`, { headers, method: opts.method ?? 'GET' }));
}
const passes = (r: Response) => r.headers.get('x-middleware-next') === '1';

describe('route inventory', () => {
  it('found the app routes', () => {
    expect(STAFF.length).toBeGreaterThan(50);
    expect(PORTAL).toEqual(expect.arrayContaining(['/client', '/client/months', '/client/pnl', '/client/pnl/export', '/client/transactions', '/client/bank']));
    expect(STAFF).toEqual(expect.arrayContaining(['/audit', '/settings/team', '/vendors', '/vendors/x1', '/firm', '/banking', '/1099/forms/x1/pdf']));
  });
});

describe('CLIENT session', () => {
  it.each(STAFF.filter((p) => p !== '/'))('gets 404 on staff route %s', async (p) => {
    const r = await request(p, 'CLIENT');
    expect(r.status).toBe(404);
  });
  it('gets 404 on staff routes for POST (server actions) too', async () => {
    for (const p of ['/banking', '/close', '/settings/team', '/audit']) {
      expect((await request(p, 'CLIENT', { method: 'POST' })).status).toBe(404);
    }
  });
  it.each(PORTAL)('may open portal route %s', async (p) => {
    expect(passes(await request(p, 'CLIENT'))).toBe(true);
  });
  it('is sent from / to the portal', async () => {
    const r = await request('/', 'CLIENT');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toMatch(/\/client$/);
  });
});

describe('staff session', () => {
  it.each(PORTAL)('gets 404 on portal route %s', async (p) => {
    expect((await request(p, 'OWNER')).status).toBe(404);
  });
  it('passes on staff routes and refreshes nothing it should not', async () => {
    expect(passes(await request('/banking', 'OWNER'))).toBe(true);
  });
  it('idle staff session is sent to login and the cookie cleared', async () => {
    const r = await request('/banking', 'OWNER', { idle: true });
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toMatch(/\/login$/);
    expect(r.headers.get('set-cookie')).toMatch(new RegExp(`${sessionCookieName()}=;`));
  });
});

describe('no session', () => {
  it.each([...STAFF.filter((p) => !p.startsWith('/api/')), ...PORTAL])('page %s redirects to login', async (p) => {
    const r = await request(p, null);
    expect(r.status).toBe(307);
  });
  it('a forged cookie is treated as no session', async () => {
    const r = await middleware(new NextRequest('http://localhost/banking', { headers: { cookie: `${sessionCookieName()}=eyJ4IjoxfQ.AAAA` } }));
    expect(r.status).toBe(307);
  });
  it.each(PUBLIC)('public route %s passes', async (p) => {
    expect(passes(await request(p, null))).toBe(true);
  });
  it('sets security headers', async () => {
    const r = await request('/login', null);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
