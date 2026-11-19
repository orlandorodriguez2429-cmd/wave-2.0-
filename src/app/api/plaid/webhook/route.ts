// POST /api/plaid/webhook — Plaid calls this; it is NOT behind a login.
// Every request is verified (signed JWT + body hash) before anything happens.
// Syncs run after the response is sent so Plaid gets a fast 200.
import { after, NextResponse } from 'next/server';
import { applyPlaidWebhook, verifyPlaidWebhook, type PlaidWebhookBody } from '@/lib/banking/plaid-webhook';
import { isPlaidConfigured } from '@/lib/banking/plaid-client';
import { syncConnection } from '@/lib/banking/sync';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isPlaidConfigured()) return NextResponse.json({ error: 'not configured' }, { status: 404 });

  // Raw text, exactly as received: the signature covers these bytes.
  const raw = await request.text();
  const verified = await verifyPlaidWebhook(raw, request.headers.get('plaid-verification'));
  if (!verified) return NextResponse.json({ error: 'unverified' }, { status: 401 });

  let body: PlaidWebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  const outcome = await applyPlaidWebhook(body);
  if (outcome.action === 'sync') {
    after(async () => {
      try {
        await syncConnection({ connectionId: outcome.connectionId, userId: null, trigger: 'webhook' });
      } catch (err) {
        // Error already recorded on the connection; log the message only
        // (sync errors carry error codes, never tokens or secrets).
        console.warn(`[plaid webhook] sync failed for ${outcome.connectionId}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    });
  }
  return NextResponse.json({ ok: true });
}
