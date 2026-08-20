import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveApiToken } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const token = await resolveApiToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const accounts = await prisma.account.findMany({
    where: { businessId: token.businessId, isArchived: false },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true, type: true, subtype: true, currency: true },
  });
  return NextResponse.json({ data: accounts });
}
