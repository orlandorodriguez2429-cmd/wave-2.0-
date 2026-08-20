import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolveApiToken } from '@/lib/api-auth';

export async function GET(req: NextRequest) {
  const token = await resolveApiToken(req.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const status = req.nextUrl.searchParams.get('status')?.toUpperCase();
  const invoices = await prisma.invoice.findMany({
    where: {
      businessId: token.businessId,
      ...(status && ['DRAFT', 'OPEN', 'PAID', 'VOID'].includes(status) ? { status: status as 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' } : {}),
    },
    orderBy: { number: 'desc' },
    take: 100,
    include: { customer: { select: { name: true } }, payments: true },
  });
  return NextResponse.json({
    data: invoices.map((inv) => ({
      id: inv.id,
      number: inv.number,
      status: inv.status,
      customer: inv.customer.name,
      issueDate: inv.issueDate.toISOString().slice(0, 10),
      dueDate: inv.dueDate.toISOString().slice(0, 10),
      currency: inv.currency,
      // Money as strings of minor units — integers, never floats.
      subtotal: inv.subtotal.toString(),
      taxTotal: inv.taxTotal.toString(),
      total: inv.total.toString(),
      paid: inv.payments.reduce((s, p) => s + p.amount, 0n).toString(),
    })),
  });
}
