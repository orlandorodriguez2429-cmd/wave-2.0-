import Link from 'next/link';

const reports = [
  {
    href: '/reports/profit-loss',
    title: 'Profit & Loss',
    desc: 'Income, cost of goods sold, and expenses over a period, with gross profit and net income.',
  },
  {
    href: '/reports/balance-sheet',
    title: 'Balance Sheet',
    desc: 'Assets, liabilities, and equity as of a date. Always balances — it is derived from the ledger.',
  },
  {
    href: '/reports/trial-balance',
    title: 'Trial Balance',
    desc: 'Every account with its net debit or credit balance. Total debits always equal total credits.',
  },
  {
    href: '/reports/cash-flow',
    title: 'Cash Flow',
    desc: 'Cash movement classified into operating, investing, and financing activities.',
  },
  {
    href: '/reports/sales-tax',
    title: 'Sales Tax',
    desc: 'Tax collected on invoices by rate and jurisdiction — what you owe each authority.',
  },
  {
    href: '/reports/aged-receivables',
    title: 'Aged Receivables',
    desc: 'Outstanding invoice balances bucketed by how overdue they are.',
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-300 hover:shadow-sm"
          >
            <h2 className="font-medium text-teal-700">{r.title}</h2>
            <p className="mt-2 text-sm text-slate-500">{r.desc}</p>
          </Link>
        ))}
      </div>
      <p className="text-sm text-slate-400">
        Every report exports to CSV from its page. Aged Payables arrives with the bills module.
      </p>
    </div>
  );
}
