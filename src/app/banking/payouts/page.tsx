import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

// Wave's Payouts shows when card/checkout payments settle into your bank
// account. There's no real processor connected (see Payments Setup), so this
// lists the sandbox card payments that would have been queued for payout.
export default async function PayoutsPage() {
  const { business } = await getCurrentContext();
  const [cardPayments, paidCheckouts] = await Promise.all([
    prisma.payment.findMany({
      where: { businessId: business.id, method: 'CARD' },
      include: { invoice: { include: { customer: true } } },
      orderBy: { date: 'desc' },
      take: 50,
    }),
    prisma.checkout.findMany({
      where: { businessId: business.id, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      take: 50,
    }),
  ]);

  const rows = [
    ...cardPayments.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      source: `Invoice #${p.invoice.number} — ${p.invoice.customer.name}`,
      amount: p.amount,
    })),
    ...paidCheckouts.map((c) => ({
      date: (c.paidAt ?? c.createdAt).toISOString().slice(0, 10),
      source: `Checkout — ${c.description}`,
      amount: c.amount,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payouts</h1>
        <p className="text-sm text-slate-500 mt-1">
          Card payments deposit straight to the books immediately in this sandbox — no processor holds
          funds or runs a payout schedule yet (see Payments Setup). This list is what those payouts would
          cover once a real processor is connected.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-3 py-3 font-medium">Source</th>
              <th className="px-5 py-3 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-3">{r.source}</td>
                <td className="px-5 py-3 text-right tabular-nums">{formatMoney(r.amount, business.functionalCurrency)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={3}>
                  No card payments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
