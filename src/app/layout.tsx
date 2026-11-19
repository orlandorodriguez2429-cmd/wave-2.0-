import type { Metadata } from 'next';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import Link from 'next/link';
import { readSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBox } from '@/components/session-box';
import { SidebarNav } from '@/components/sidebar-nav';
import { ClientNav } from '@/components/client-nav';
import './globals.css';


export const metadata: Metadata = {
  title: 'Your Tax Solution Books',
  description: 'Month-to-month bookkeeping, Profit & Loss and 1099s, fed by your bank.',
};

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

  if (active?.role === 'CLIENT' && user) {
    return (
      <html lang="en">
        <body className="antialiased bg-[var(--background)] text-slate-900">
          <ClientNav businessName={active.business.name} userName={user.name} />
          <main className="mx-auto max-w-5xl px-4 sm:px-8 py-8">{children}</main>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className="antialiased bg-[var(--background)] text-slate-900">
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 bg-[var(--brand-navy)] flex flex-col">
            <Link href="/" className="mx-3 mt-4 mb-4 flex items-center gap-3 rounded-lg bg-white px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/yts-logo.jpg" alt="Your Tax Solution" width={40} height={44} className="h-11 w-auto" />
              <span className="leading-tight">
                <span className="block text-[15px] font-bold tracking-tight text-[var(--brand-navy)]">
                  <span className="text-[var(--brand-red)]">Your Tax</span> Solution
                </span>
                <span className="block text-[11px] text-slate-500">Books · P&amp;L · 1099</span>
              </span>
            </Link>
            <SidebarNav />
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
