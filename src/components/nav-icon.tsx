import type { ReactNode } from 'react';

// Small monoline icon set for the sidebar's top-level items — generic
// line-icon shapes (not brand assets), 16x16, inherits color via currentColor.
export type NavIconName =
  | 'dashboard'
  | 'sales'
  | 'purchases'
  | 'receipts'
  | 'accounting'
  | 'banking'
  | 'payroll'
  | 'reports'
  | 'advisors'
  | 'tax'
  | 'perks';

const PATHS: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </>
  ),
  sales: (
    <>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" />
      <line x1="4" y1="9.5" x2="7" y2="9.5" />
    </>
  ),
  purchases: (
    <>
      <path d="M2 3h1.5l1.2 7.4a1.2 1.2 0 0 0 1.2 1h6.2a1.2 1.2 0 0 0 1.2-1L14.5 5.5H4" />
      <circle cx="6.2" cy="13.2" r="1" />
      <circle cx="11.5" cy="13.2" r="1" />
    </>
  ),
  receipts: (
    <>
      <path d="M4 1.5h8v13l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1v-13Z" />
      <line x1="6" y1="5" x2="10" y2="5" />
      <line x1="6" y1="8" x2="10" y2="8" />
    </>
  ),
  accounting: (
    <>
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="3" y1="4.5" x2="13" y2="4.5" />
      <path d="M3 4.5 1.2 8.5a1.8 1.8 0 0 0 3.6 0Z" />
      <path d="M13 4.5 11.2 8.5a1.8 1.8 0 0 0 3.6 0Z" />
      <line x1="5.5" y1="14" x2="10.5" y2="14" />
    </>
  ),
  banking: (
    <>
      <path d="M1.5 6 8 2l6.5 4" />
      <line x1="2" y1="6" x2="14" y2="6" />
      <line x1="3" y1="7.5" x2="3" y2="12.5" />
      <line x1="6.3" y1="7.5" x2="6.3" y2="12.5" />
      <line x1="9.7" y1="7.5" x2="9.7" y2="12.5" />
      <line x1="13" y1="7.5" x2="13" y2="12.5" />
      <line x1="1.5" y1="14" x2="14.5" y2="14" />
    </>
  ),
  payroll: (
    <>
      <circle cx="8" cy="5.2" r="2.7" />
      <path d="M2.5 14c0-2.9 2.5-4.7 5.5-4.7s5.5 1.8 5.5 4.7" />
    </>
  ),
  reports: (
    <>
      <line x1="3" y1="14" x2="3" y2="7" />
      <line x1="8" y1="14" x2="8" y2="3" />
      <line x1="13" y1="14" x2="13" y2="9.5" />
      <line x1="1.5" y1="14" x2="14.5" y2="14" />
    </>
  ),
  advisors: (
    <>
      <circle cx="5.5" cy="5.5" r="2.2" />
      <circle cx="11" cy="6.2" r="1.8" />
      <path d="M1.3 14c0-2.5 1.9-4 4.2-4s4.2 1.5 4.2 4" />
      <path d="M9.8 10.6c1.9.2 3.2 1.5 3.2 3.4" />
    </>
  ),
  tax: (
    <>
      <path d="M4 1.5h6l2.5 2.5v10.5h-8.5v-13Z" />
      <line x1="5.5" y1="6" x2="10.5" y2="6" />
      <line x1="5.5" y1="8.7" x2="10.5" y2="8.7" />
      <line x1="5.5" y1="11.4" x2="8.5" y2="11.4" />
    </>
  ),
  perks: (
    <>
      <rect x="2" y="6" width="12" height="8" rx="1" />
      <line x1="2" y1="9" x2="14" y2="9" />
      <line x1="8" y1="6" x2="8" y2="14" />
      <path d="M8 6C6.5 6 5 5.3 5 3.8A1.8 1.8 0 0 1 8 3c0-1 1-1.8 1.8-1.8A1.8 1.8 0 0 1 11 3c0 1.5-1.5 3-3 3Z" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
