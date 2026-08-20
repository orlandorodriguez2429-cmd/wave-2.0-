import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { renderInvoicePdf } from '@/lib/pdf/invoice-pdf';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { business } = await getCurrentContext();
  const invoice = await prisma.invoice.findUnique({ where: { id }, select: { businessId: true, number: true } });
  if (!invoice || invoice.businessId !== business.id) {
    return new NextResponse('Not found', { status: 404 });
  }
  const pdf = await renderInvoicePdf(id);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="invoice-${invoice.number}.pdf"`,
    },
  });
}
