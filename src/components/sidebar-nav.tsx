'use client';

import Link from 'next/link';
import { useState } from 'react';

type Item = { href: string; label: string; badge?: string };

const createLinks: Item[] = [
  { href: '/invoices/new', label: 'Invoice' },
  { href: '/estimates/new', label: 'Estimate' },
  { href: '/bills/new', label: 'Bill' },
  { href: '/expenses/new', label: 'Expense' },
  { href: '/journal/new', label: 'Journal transaction' },
];

const accountingLinks: Item[] = [
  { href: '/journal', label: 'Transactions' },
  { href: '/accounting/tags', label: 'Tags', badge: 'New' },
  { href: '/accounts', label: 'Chart of Accounts' },
  { href: '/close', label: 'Close the Books' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/accounting/hire-a-bookkeeper', label: 'Hire a Bookkeeper' },
];

export function SidebarNav() {
  const [accountingOpen, setAccountingOpen] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <nav className="px-3 pb-3 space-y-0.5 flex-1 overflow-y-auto">
      <div className="relative mb-3">
        <button
          onClick={() => setCreateOpen((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 rounded-md bg-teal-500 px-3 py-2 text-sm font-semibold text-[#0e2438] hover:bg-teal-400"
        >
          <span className="text-base leading-none">+</span> Create new
        </button>
        {createOpen && (
          <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-700 bg-[#122c44] py-1 shadow-lg">
            {createLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setCreateOpen(false)}
                className="block px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 hover:text-white"
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <TopLink href="/" label="Dashboard" />
      <TopLink href="/sales" label="Sales & Payments" />
      <TopLink href="/purchases" label="Purchases" />
      <TopLink href="/receipts" label="Receipts" />

      <button
        onClick={() => setAccountingOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white border-l-2 border-transparent hover:border-teal-400"
      >
        Accounting
        <span className="text-xs text-slate-500">{accountingOpen ? '▾' : '▸'}</span>
      </button>
      {accountingOpen && (
        <div className="ml-3 space-y-0.5 border-l border-white/10 pl-2">
          {accountingLinks.map((l) => (
            <TopLink key={l.href} href={l.href} label={l.label} badge={l.badge} small />
          ))}
        </div>
      )}

      <TopLink href="/banking" label="Banking" />
      <TopLink href="/payroll" label="Payroll" />
      <TopLink href="/reports" label="Reports" />
      <TopLink href="/advisors" label="Wave Advisors" />
      <TopLink href="/tax-filing" label="Tax filing" />
      <TopLink href="/perks" label="Perks" badge="New" />

      <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Settings</p>
      <TopLink href="/settings/invoicing" label="Invoicing" small />
      <TopLink href="/settings/team" label="Team & API" small />
    </nav>
  );
}

function TopLink({ href, label, badge, small }: Item & { small?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-md px-3 py-1.5 ${
        small ? 'text-[13px]' : 'text-sm'
      } font-medium text-slate-300 hover:bg-white/10 hover:text-white border-l-2 border-transparent hover:border-teal-400`}
    >
      <span>{label}</span>
      {badge && (
        <span className="rounded-full bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">
          {badge}
        </span>
      )}
    </Link>
  );
}
