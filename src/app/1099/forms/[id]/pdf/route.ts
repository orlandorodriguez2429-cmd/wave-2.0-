import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { renderForm1099Pdf } from '@/lib/pdf/form1099-pdf';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { business } = await getCurrentContext();
  const form = await prisma.form1099.findUnique({ where: { id }, select: { businessId: true, formKind: true, taxYear: true } });
  if (!form || form.businessId !== business.id) return new NextResponse('Not found', { status: 404 });
  const copyParam = req.nextUrl.searchParams.get('copy')?.toUpperCase();
  const copy = copyParam === 'A' || copyParam === 'C' ? copyParam : 'B';
  const pdf = await renderForm1099Pdf(id, copy);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="1099-${form.formKind}-${form.taxYear}-copy${copy}.pdf"`,
    },
  });
}
