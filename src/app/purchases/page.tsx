import Link from 'next/link';

export const dynamic = 'force-dynamic';

const cards = [
  { href: '/bills', title: 'Bills', description: 'Enter bills now, pay them later. Tracks Accounts Payable.' },
  { href: '/expenses', title: 'Expenses', description: 'Record money you’ve already paid out.' },
  { href: '/vendors', title: 'Vendors', description: 'Manage suppliers, contractors, and W-9s.' },
  { href: '/mileage', title: 'Mileage', description: 'Track deductible business mileage.' },
];

export default function PurchasesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Purchases</h1>
        <p className="text-sm text-slate-500 mt-1">Everything you buy or owe, in one place.</p>
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
