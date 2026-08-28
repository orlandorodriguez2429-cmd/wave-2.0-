'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NavIcon, type NavIconName } from '@/components/nav-icon';

type Item = { href: string; label: string; badge?: string };

const createLinks: Item[] = [
  { href: '/invoices/new', label: 'Invoice' },
  { href: '/estimates/new', label: 'Estimate' },
  { href: '/bills/new', label: 'Bill' },
  { href: '/expenses/new', label: 'Expense' },
  { href: '/journal/new', label: 'Journal transaction' },
];

const salesLinks: Item[] = [
  { href: '/estimates', label: 'Estimates' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/settings/payments', label: 'Payments Setup' },
  { href: '/invoices/recurring', label: 'Recurring Invoices' },
  { href: '/checkouts', label: 'Checkouts' },
  { href: '/customers/statements', label: 'Customer Statements' },
  { href: '/customers', label: 'Customers' },
  { href: '/products', label: 'Products & Services' },
];

const purchasesLinks: Item[] = [
  { href: '/bills', label: 'Bills' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/products', label: 'Products & Services' },
];

const accountingLinks: Item[] = [
  { href: '/journal', label: 'Transactions' },
  { href: '/accounting/tags', label: 'Tags', badge: 'New' },
  { href: '/accounts', label: 'Chart of Accounts' },
  { href: '/close', label: 'Close the Books' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/accounting/hire-a-bookkeeper', label: 'Hire a Bookkeeper' },
];

const bankingLinks: Item[] = [
  { href: '/banking', label: 'Connected Accounts' },
  { href: '/banking/payouts', label: 'Payouts' },
  { href: '/banking/insurance', label: 'Insurance' },
];

const payrollLinks: Item[] = [
  { href: '/payroll', label: 'Payroll Dashboard' },
  { href: '/payroll/employees', label: 'Employees' },
  { href: '/payroll/timesheets', label: 'Payroll Timesheets' },
  { href: '/payroll/transactions', label: 'Payroll Transactions' },
  { href: '/payroll/taxes', label: 'Taxes' },
  { href: '/payroll/tax-forms', label: 'Tax Forms' },
];

export function SidebarNav() {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const [open, setOpen] = useState({
    sales: true,
    purchases: false,
    accounting: false,
    banking: false,
    payroll: false,
  });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

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

      <TopLink href="/" label="Dashboard" icon="dashboard" active={pathname === '/'} />

      <Section title="Sales & Payments" icon="sales" open={open.sales} onToggle={() => toggle('sales')} links={salesLinks} pathname={pathname} />
      <Section title="Purchases" icon="purchases" open={open.purchases} onToggle={() => toggle('purchases')} links={purchasesLinks} pathname={pathname} />
      <TopLink href="/receipts" label="Receipts" icon="receipts" active={pathname === '/receipts'} />
      <Section title="Accounting" icon="accounting" open={open.accounting} onToggle={() => toggle('accounting')} links={accountingLinks} pathname={pathname} />
      <Section title="Banking" icon="banking" open={open.banking} onToggle={() => toggle('banking')} links={bankingLinks} pathname={pathname} />
      <Section title="Payroll" icon="payroll" open={open.payroll} onToggle={() => toggle('payroll')} links={payrollLinks} pathname={pathname} />
      <TopLink href="/reports" label="Reports" icon="reports" active={pathname === '/reports'} />
      <TopLink href="/advisors" label="Wave Advisors" icon="advisors" active={pathname === '/advisors'} />
      <TopLink href="/tax-filing" label="Tax filing" icon="tax" active={pathname?.startsWith('/tax-filing')} />
      <TopLink href="/perks" label="Perks" icon="perks" badge="New" active={pathname === '/perks'} />

      <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Settings</p>
      <TopLink href="/settings/invoicing" label="Invoicing" small active={pathname === '/settings/invoicing'} />
      <TopLink href="/settings/team" label="Team & API" small active={pathname === '/settings/team'} />
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
