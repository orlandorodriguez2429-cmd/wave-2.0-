// First line of access control (the second is context.ts on every page and
// action, the third is every query being scoped to the session's business):
//   * public routes pass through (login, invite links, W-9 links, the
//     invoice payment portal, webhooks/cron/API with their own auth, legal);
//   * everything else needs a live signed session (signature, 12 h absolute,
//     idle timeout: staff 30 min / clients 2 h) — otherwise to /login;
//   * a CLIENT session may only reach /client/**; anything else is a 404,
//     and staff never see /client/**;
//   * the session's activity time is refreshed (sliding idle timeout);
//   * security headers on every response.
import { NextResponse, type NextRequest } from 'next/server';
import {
  cookieOptions,
  MAX_SESSION_SECONDS,
  REFRESH_AFTER_SECONDS,
  sessionCookieName,
  sessionIsLive,
  signToken,
  verifyToken,
} from '@/lib/session-core';

const PUBLIC_PREFIXES = [
  '/login', // includes /login/mfa (guarded by its own pending-MFA cookie)
  '/invite/',
  '/reset/',
  '/w9/',
  '/portal/',
  '/pay/',
  '/api/plaid/webhook',
  '/api/cron/',
  '/api/health',
  '/api/v1/',
  '/privacy',
  '/terms',
];

export function isPublicPath(path: string): boolean {
  // "/x/" entries are prefixes; "/x" entries match "/x" and "/x/…".
  return PUBLIC_PREFIXES.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
}

/** Which signed-in roles may open a path. */
export function allowedFor(role: string, path: string): boolean {
  const portal = path === '/client' || path.startsWith('/client/');
  return role === 'CLIENT' ? portal : !portal;
}

function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  return res;
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (isPublicPath(path)) return withSecurityHeaders(NextResponse.next());

  const payload = await verifyToken(req.cookies.get(sessionCookieName())?.value);
  const now = Math.floor(Date.now() / 1000);
  if (!sessionIsLive(payload, now)) {
    const res = path.startsWith('/api/')
      ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete(sessionCookieName());
    return withSecurityHeaders(res);
  }

  if (payload.role === 'CLIENT' && path === '/') {
    return withSecurityHeaders(NextResponse.redirect(new URL('/client', req.url)));
  }
  if (!allowedFor(payload.role, path)) {
    return withSecurityHeaders(new NextResponse('Not found', { status: 404 }));
  }

  // Tell the server which page this is (for view audit logging). Any value
  // a browser sent in this header is overwritten.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-yts-path', path);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (now - payload.lastActive >= REFRESH_AFTER_SECONDS) {
    const refreshed = await signToken({ ...payload, lastActive: now });
    res.cookies.set(sessionCookieName(), refreshed, cookieOptions(Math.max(60, payload.exp - now) || MAX_SESSION_SECONDS));
  }
  return withSecurityHeaders(res);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)$).*)'],
};
