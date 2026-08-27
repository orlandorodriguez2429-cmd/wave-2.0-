import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import { readSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBox } from '@/components/session-box';
import { SidebarNav } from '@/components/sidebar-nav';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Wave 2.0',
  description: 'Double-entry accounting for small businesses',
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

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--background)] text-slate-900`}>
        <div className="flex min-h-screen">
          <aside className="w-60 shrink-0 bg-[#0e2438] flex flex-col">
            <div className="px-5 py-5 flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-500 text-[#0e2438] font-bold text-sm">
                W
              </span>
              <div>
                <Link href="/" className="text-base font-semibold tracking-tight text-white leading-none">
                  Wave&nbsp;2.0
                </Link>
                <p className="text-[11px] text-slate-400 mt-0.5">Small-business accounting</p>
              </div>
            </div>
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
