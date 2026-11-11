'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { logoutAction } from '@/app/auth-actions';

const LINKS = [
  { href: '/client', label: 'Dashboard' },
  { href: '/client/months', label: 'Months' },
  { href: '/client/pnl', label: 'Profit & Loss' },
  { href: '/client/transactions', label: 'Transactions' },
  { href: '/client/bank', label: 'Bank' },
];

export function ClientNav({ businessName, userName }: { businessName: string; userName: string }) {
  const pathname = usePathname();
  const [pending, start] = useTransition();
  return (
    <header className="bg-[#0e2438] text-white">
      <div className="mx-auto max-w-5xl px-4 sm:px-8 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 mr-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500 text-[#0e2438] font-bold text-xs">YT</span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">{businessName}</p>
            <p className="text-[11px] text-slate-400">Your Tax Solution · client portal</p>
          </div>
        </div>
        <nav className="flex flex-wrap gap-1 flex-1">
          {LINKS.map((l) => {
            const active = l.href === '/client' ? pathname === '/client' : pathname?.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`rounded-md px-3 py-1.5 text-sm ${active ? 'bg-white/15 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/client/account" className="text-slate-400 hover:text-white">{userName}</Link>
          <button disabled={pending} onClick={() => start(() => logoutAction())} className="text-slate-300 hover:text-white">Sign out</button>
        </div>
      </div>
    </header>
  );
}
