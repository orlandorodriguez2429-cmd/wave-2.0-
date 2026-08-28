import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { CheckoutPayButton } from './pay-button';

export const dynamic = 'force-dynamic';

// Public, token-addressed checkout page (no login) — Wave's "Checkouts":
// a standalone payment link not tied to an invoice.
export default async function CheckoutPayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const checkout = await prisma.checkout.findUnique({
    where: { token },
    include: { business: true },
  });
  if (!checkout) notFound();

  return (
    <div className="fixed inset-0 overflow-auto bg-slate-100 py-10">
      <div className="mx-auto max-w-md space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <p className="text-sm text-slate-500">{checkout.business.name}</p>
          <h1 className="text-xl font-semibold mt-1">{checkout.description}</h1>
        </div>
        <p className="text-3xl font-bold tabular-nums">{formatMoney(checkout.amount, checkout.currency)}</p>

        {checkout.status === 'OPEN' && (
          <div className="rounded-lg border border-teal-100 bg-teal-50 p-4 space-y-2">
            <CheckoutPayButton token={token} amountLabel={formatMoney(checkout.amount, checkout.currency)} />
            <p className="text-xs text-slate-500">Sandbox payment — records a card payment in the books.</p>
          </div>
        )}
        {checkout.status === 'PAID' && (
          <p className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-700">
            Paid — thank you!
          </p>
        )}
        {checkout.status === 'VOID' && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-600">
            This checkout link is no longer active.
          </p>
        )}
      </div>
    </div>
  );
}
