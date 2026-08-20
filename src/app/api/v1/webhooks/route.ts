import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveApiToken } from '@/lib/api-auth';

const SUPPORTED_EVENTS = ['invoice.approved', 'invoice.paid', 'journal_entry.posted'];

export async function GET(req: NextRequest) {
  const token = await resolveApiToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const subs = await prisma.webhookSubscription.findMany({
    where: { businessId: token.businessId },
    select: { id: true, url: true, events: true, isActive: true, createdAt: true },
  });
  return NextResponse.json({ data: subs, supportedEvents: SUPPORTED_EVENTS });
}

export async function POST(req: NextRequest) {
  const token = await resolveApiToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: { url?: string; events?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.url || !/^https?:\/\//.test(body.url)) {
    return NextResponse.json({ error: 'url must be http(s)' }, { status: 400 });
  }
  const events = (body.events ?? []).filter((e) => SUPPORTED_EVENTS.includes(e));
  if (events.length === 0) {
    return NextResponse.json({ error: `events must include one of: ${SUPPORTED_EVENTS.join(', ')}` }, { status: 400 });
  }
  const secret = randomBytes(24).toString('hex');
  const sub = await prisma.webhookSubscription.create({
    data: { businessId: token.businessId, url: body.url, events, secret },
  });
  // Secret is returned once; store it to verify X-Wave-Signature.
  return NextResponse.json({ data: { id: sub.id, url: sub.url, events: sub.events, secret } }, { status: 201 });
}
