import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { readSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBox } from '@/components/session-box';
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
  { label: 'Contractors & 1099', heading: true },
  { href: '/1099', label: '1099 Tracking' },
  { href: '/1099/forms', label: '1099 Forms & E-file' },
  { href: '/settings/1099', label: '1099 Settings' },
  { label: 'Banking', heading: true },
  { href: '/banking', label: 'Transactions' },
  { href: '/banking/reconcile', label: 'Reconciliation' },
  { href: '/banking/rules', label: 'Rules' },
  { label: 'Accounting', heading: true },
  { href: '/accounts', label: 'Chart of Accounts' },
  { href: '/journal', label: 'Journal' },
  { href: '/reports', label: 'Reports' },
  { href: '/taxes', label: 'Sales Tax' },
  { href: '/close', label: 'Close the Books' },
  { href: '/audit', label: 'Audit Log' },
  { label: 'Settings', heading: true },
  { href: '/settings/team', label: 'Team & API' },
];

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await readSession();
  const user = session
    ? await prisma.user.findUnique({
        where: { id: session.userId },
        include: { memberships: { include: { business: true }, orderBy: { createdAt: 'asc' } } },
      })
    : null;
  const active =
    user?.memberships.find((m) => m.businessId === session?.businessId) ?? user?.memberships[0];

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900`}>
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 border-r border-slate-200 bg-white flex flex-col">
            <div className="px-5 py-5 border-b border-slate-100">
              <Link href="/" className="text-lg font-semibold tracking-tight text-blue-700">
                Wave&nbsp;2.0
              </Link>
              <p className="text-xs text-slate-400 mt-0.5">Small-business accounting</p>
            </div>
            <nav className="p-3 space-y-0.5 flex-1 overflow-y-auto">
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
            {user && active && (
              <SessionBox
                userName={user.name}
                role={active.role}
                businessId={active.businessId}
                memberships={user.memberships.map((m) => ({
                  businessId: m.businessId,
                  businessName: m.business.name,
                  role: m.role,
                }))}
              />
            )}
          </aside>
          <main className="flex-1 px-8 py-8 max-w-6xl">{children}</main>
        </div>
      </body>
    </html>
  );
}
