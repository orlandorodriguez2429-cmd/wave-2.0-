import { prisma } from '@/lib/db';

// Reusable price-list entries shared by Sales & Payments and Purchases —
// not yet wired into the invoice/bill line-item pickers, just the catalog.

export async function createProduct(opts: {
  businessId: string;
  name: string;
  description?: string;
  sku?: string;
  unitPrice: bigint;
  incomeAccountId: string;
}) {
  return prisma.product.create({
    data: {
      businessId: opts.businessId,
      name: opts.name,
      description: opts.description?.trim() || null,
      sku: opts.sku?.trim() || null,
      unitPrice: opts.unitPrice,
      incomeAccountId: opts.incomeAccountId,
    },
  });
}

export async function archiveProduct(opts: { businessId: string; productId: string }) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: opts.productId } });
  if (product.businessId !== opts.businessId) throw new Error('Wrong business.');
  return prisma.product.update({ where: { id: product.id }, data: { isArchived: true } });
}
