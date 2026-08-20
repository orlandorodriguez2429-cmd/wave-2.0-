import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Wave 2.0',
  description: 'Double-entry accounting for small businesses',
};

const nav: Array<{ href?: string; label: string; heading?: boolean }> = [
  { href: '/', label: 'Dashboard' },
  { label: 'Sales', heading: true },
  { href: '/invoices', label: 'Invoices' },
  { href: '/estimates', label: 'Estimates' },
  { href: '/customers', label: 'Customers' },
  { label: 'Purchases', heading: true },
  { href: '/expenses', label: 'Expenses' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/mileage', label: 'Mileage' },
  { label: 'Accounting', heading: true },
  { href: '/accounts', label: 'Chart of Accounts' },
  { href: '/journal', label: 'Journal' },
  { href: '/reports', label: 'Reports' },
  { href: '/taxes', label: 'Sales Tax' },
  { href: '/audit', label: 'Audit Log' },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900`}>
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
            <div className="px-5 py-5 border-b border-slate-100">
              <Link href="/" className="text-lg font-semibold tracking-tight text-blue-700">
                Wave&nbsp;2.0
              </Link>
              <p className="text-xs text-slate-400 mt-0.5">Small-business accounting</p>
            </div>
            <nav className="p-3 space-y-0.5">
              {nav.map((item) =>
                item.heading ? (
                  <p key={item.label} className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {item.label}
                  </p>
                ) : (
                  <Link
                    key={item.href}
                    href={item.href!}
                    className="block rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {item.label}
                  </Link>
                ),
              )}
            </nav>
          </aside>
          <main className="flex-1 px-8 py-8 max-w-6xl">{children}</main>
        </div>
      </body>
    </html>
  );
}
