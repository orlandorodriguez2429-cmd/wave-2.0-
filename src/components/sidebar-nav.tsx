'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NavIcon, type NavIconName } from '@/components/nav-icon';

type Item = { href: string; label: string; badge?: string };

// The app does four things: month-to-month books, bank connections, Profit &
// Loss, and 1099s. Everything else in the codebase (invoicing, bills,
// payroll, …) is deliberately left out of the menu; the pages still exist and
// can be brought back by adding them here.

const form1099Links: Item[] = [
  { href: '/1099', label: '1099 tracking' },
  { href: '/vendors', label: 'Contractors & W-9s' },
  { href: '/1099/forms', label: '1099 forms & e-file' },
  { href: '/settings/1099', label: '1099 settings' },
];

// Accountant tools needed to fix the books (corrections are reversals).
const booksLinks: Item[] = [
  { href: '/journal', label: 'Journal entries' },
  { href: '/accounts', label: 'Chart of accounts' },
  { href: '/banking/rules', label: 'Categorization rules' },
  { href: '/banking/reconcile', label: 'Reconciliation' },
  { href: '/audit', label: 'Audit log' },
];

export function SidebarNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState({
    f1099: pathname?.startsWith('/1099') || pathname?.startsWith('/vendors') || pathname === '/settings/1099',
    books: false,
  });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <nav className="px-3 pb-3 space-y-0.5 flex-1 overflow-y-auto">
      <TopLink href="/" label="Dashboard" icon="dashboard" active={pathname === '/'} />
      <TopLink href="/banking" label="Bank accounts" icon="banking" active={pathname === '/banking'} />
      <TopLink href="/close" label="Months" icon="accounting" active={pathname === '/close'} />
      <TopLink
        href="/reports/profit-loss"
        label="Profit & Loss"
        icon="reports"
        active={pathname === '/reports/profit-loss'}
      />
      <Section title="1099s" icon="tax" open={!!open.f1099} onToggle={() => toggle('f1099')} links={form1099Links} pathname={pathname} />

      <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Accountant</p>
      <TopLink href="/firm" label="All clients" icon="advisors" active={pathname === '/firm'} />
      <Section title="Books" icon="purchases" open={open.books} onToggle={() => toggle('books')} links={booksLinks} pathname={pathname} />
      <TopLink href="/settings/team" label="Team" small active={pathname === '/settings/team'} />
    </nav>
  );
}

function Section({
  title,
  icon,
  open,
  onToggle,
  links,
  pathname,
}: {
  title: string;
  icon: NavIconName;
  open: boolean;
  onToggle: () => void;
  links: Item[];
  pathname: string | null;
}) {
  return (
    <>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white border-l-2 border-transparent hover:border-teal-400"
      >
        <NavIcon name={icon} className="shrink-0 text-slate-400" />
        <span className="flex-1 text-left">{title}</span>
        <span className="text-xs text-slate-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="ml-3 space-y-0.5 border-l border-white/10 pl-2">
          {links.map((l) => (
            <TopLink key={l.href} href={l.href} label={l.label} badge={l.badge} small active={pathname === l.href} />
          ))}
        </div>
      )}
    </>
  );
}

function TopLink({ href, label, icon, badge, small, active }: Item & { icon?: NavIconName; small?: boolean; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-3 py-1.5 ${
        small ? 'text-[13px]' : 'text-sm'
      } font-medium ${active ? 'bg-[#16324a] text-white' : 'text-slate-300'} hover:bg-white/10 hover:text-white border-l-2 ${
        active ? 'border-teal-400' : 'border-transparent'
      } hover:border-teal-400`}
    >
      {icon && <NavIcon name={icon} className={`shrink-0 ${active ? 'text-teal-400' : 'text-slate-400'}`} />}
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="rounded-full bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">
          {badge}
        </span>
      )}
    </Link>
  );
}
