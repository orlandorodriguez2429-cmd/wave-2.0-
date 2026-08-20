import { NextRequest, NextResponse } from 'next/server';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { storage } from '@/lib/storage';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { business } = await getCurrentContext();
  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file || file.businessId !== business.id) return new NextResponse('Not found', { status: 404 });
  const data = await storage.get(file.key);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': `inline; filename="${file.filename.replace(/[^\w.\- ]/g, '_')}"`,
    },
  });
}
