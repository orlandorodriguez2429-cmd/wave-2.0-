import Link from 'next/link';

export const dynamic = 'force-dynamic';

const cards = [
  { href: '/1099', title: '1099 Tracking', description: 'Per-vendor payment totals against the IRS threshold.' },
  { href: '/1099/forms', title: '1099 Forms & E-file', description: 'Generate, correct, and transmit 1099-NEC/MISC forms.' },
  { href: '/settings/1099', title: '1099 Settings', description: 'Thresholds, boxes, and filer information.' },
  { href: '/taxes', title: 'Sales Tax', description: 'Sales tax collected, by jurisdiction and period.' },
];

export default function TaxFilingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tax filing</h1>
        <p className="text-sm text-slate-500 mt-1">Contractor 1099s and sales tax reporting.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm transition"
          >
            <h2 className="text-base font-semibold text-slate-900">{c.title}</h2>
            <p className="text-sm text-slate-500 mt-1">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
