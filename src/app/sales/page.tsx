import Link from 'next/link';

export const dynamic = 'force-dynamic';

const cards = [
  { href: '/invoices', title: 'Invoices', description: 'Create, send, and track invoices and payments.' },
  { href: '/estimates', title: 'Estimates', description: 'Quote work before you invoice for it.' },
  { href: '/customers', title: 'Customers', description: 'Manage the people and businesses you bill.' },
];

export default function SalesAndPaymentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales & Payments</h1>
        <p className="text-sm text-slate-500 mt-1">Everything related to billing your customers, in one place.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
