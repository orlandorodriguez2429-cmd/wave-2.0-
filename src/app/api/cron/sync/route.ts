// POST /api/cron/sync — daily backstop sync for every bank connection.
// Called by the host's scheduler with the CRON_SECRET, as either
//   Authorization: Bearer <CRON_SECRET>   or   X-Cron-Secret: <CRON_SECRET>
// Anything else gets a 401. Safe to call repeatedly.
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { syncAllConnections } from '@/lib/banking/sync-all';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sameSecret(given: string, expected: string): boolean {
  // Hash both so the comparison is constant-time regardless of length.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  const auth = request.headers.get('authorization');
  const given = auth?.startsWith('Bearer ') ? auth.slice(7) : (request.headers.get('x-cron-secret') ?? '');
  if (!given || !sameSecret(given, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await syncAllConnections({ trigger: 'cron' });
  return NextResponse.json({ success: true, ...result });
}
