import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

interface StatementLine {
  date: string;
  type: 'Invoice' | 'Payment';
  ref: string;
  charge: bigint;
  credit: bigint;
}

export default async function CustomerStatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const { business } = await getCurrentContext();
  const customers = await prisma.customer.findMany({
    where: { businessId: business.id },
    orderBy: { name: 'asc' },
  });

  const customerId = params.customerId || customers[0]?.id || '';
  const from = params.from || '2000-01-01';
  const to = params.to || new Date().toISOString().slice(0, 10);

  let lines: StatementLine[] = [];
  let openingBalance = 0n;
  const customer = customers.find((c) => c.id === customerId);

  if (customer) {
    const [invoicesBefore, invoicesInRange] = await Promise.all([
      prisma.invoice.findMany({
        where: { customerId, businessId: business.id, status: { in: ['OPEN', 'PAID'] }, issueDate: { lt: new Date(from) } },
        include: { payments: true },
      }),
      prisma.invoice.findMany({
        where: { customerId, businessId: business.id, status: { in: ['OPEN', 'PAID'] }, issueDate: { gte: new Date(from), lte: new Date(to) } },
        include: { payments: true },
      }),
    ]);
    for (const inv of invoicesBefore) {
      openingBalance += inv.total;
      for (const p of inv.payments) if (p.date < new Date(from)) openingBalance -= p.amount;
    }
    for (const inv of invoicesInRange) {
      lines.push({ date: inv.issueDate.toISOString().slice(0, 10), type: 'Invoice', ref: `#${inv.number}`, charge: inv.total, credit: 0n });
      for (const p of inv.payments) {
        if (p.date >= new Date(from) && p.date <= new Date(to)) {
          lines.push({ date: p.date.toISOString().slice(0, 10), type: 'Payment', ref: `#${inv.number}`, charge: 0n, credit: p.amount });
        }
      }
    }
    lines = lines.sort((a, b) => a.date.localeCompare(b.date));
  }

  let running = openingBalance;
  const rows = lines.map((l) => {
    running = running + l.charge - l.credit;
    return { ...l, balance: running };
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Customer Statements</h1>
        <p className="text-sm text-slate-500 mt-1">Invoices and payments for one customer, with a running balance.</p>
      </div>

      <form method="GET" className="rounded-lg border border-slate-200 bg-white p-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">Customer</span>
          <select name="customerId" defaultValue={customerId} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm bg-white">
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">From</span>
          <input type="date" name="from" defaultValue={params.from || ''} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-500 mb-1">To</span>
          <input type="date" name="to" defaultValue={to} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
        </label>
        <button type="submit" className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700">
          View
        </button>
      </form>

      {customer ? (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium">Ref</th>
                <th className="px-3 py-3 font-medium text-right">Charge</th>
                <th className="px-3 py-3 font-medium text-right">Payment</th>
                <th className="px-5 py-3 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-50 bg-slate-50">
                <td className="px-5 py-2.5 text-slate-500" colSpan={5}>Opening balance</td>
                <td className="px-5 py-2.5 text-right tabular-nums font-medium">
                  {formatMoney(openingBalance, business.functionalCurrency)}
                </td>
              </tr>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2.5">{r.type}</td>
                  <td className="px-3 py-2.5 text-slate-500">{r.ref}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.charge ? formatMoney(r.charge, business.functionalCurrency) : ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.credit ? formatMoney(r.credit, business.functionalCurrency) : ''}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums font-medium">{formatMoney(r.balance, business.functionalCurrency)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-5 py-6 text-slate-400" colSpan={6}>No activity in this date range.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">No customers yet.</p>
      )}
    </div>
  );
}
