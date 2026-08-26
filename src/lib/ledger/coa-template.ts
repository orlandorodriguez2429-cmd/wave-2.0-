import type { AccountType } from '@/generated/prisma/enums';

export interface CoaTemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  description?: string;
  /** System accounts are required by the engine and cannot be deleted. */
  isSystem?: boolean;
}

// Standard small-business chart of accounts seeded on business creation.
// Codes follow the common 1xxx assets / 2xxx liabilities / 3xxx equity /
// 4xxx income / 5xxx COGS / 6xxx expenses convention. Fully editable and
// extensible per business afterwards.
export const STANDARD_COA: CoaTemplateAccount[] = [
  // Assets
  { code: '1000', name: 'Cash on Hand', type: 'ASSET', subtype: 'cash_and_bank', isSystem: true },
  { code: '1010', name: 'Checking Account', type: 'ASSET', subtype: 'cash_and_bank' },
  { code: '1020', name: 'Savings Account', type: 'ASSET', subtype: 'cash_and_bank' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', subtype: 'accounts_receivable', isSystem: true },
  { code: '1200', name: 'Inventory', type: 'ASSET', subtype: 'inventory' },
  { code: '1300', name: 'Prepaid Expenses', type: 'ASSET', subtype: 'other_current_asset' },
  { code: '1400', name: 'Undeposited Funds', type: 'ASSET', subtype: 'cash_and_bank' },
  { code: '1500', name: 'Property, Plant & Equipment', type: 'ASSET', subtype: 'fixed_asset' },
  { code: '1510', name: 'Accumulated Depreciation', type: 'ASSET', subtype: 'contra_asset',
    description: 'Contra-asset; normally carries a credit balance.' },

  // Liabilities
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subtype: 'accounts_payable', isSystem: true },
  { code: '2100', name: 'Credit Card Payable', type: 'LIABILITY', subtype: 'credit_card' },
  { code: '2200', name: 'Sales Tax Payable', type: 'LIABILITY', subtype: 'sales_tax', isSystem: true },
  { code: '2300', name: 'Payroll Liabilities', type: 'LIABILITY', subtype: 'payroll' },
  { code: '2400', name: 'Unearned Revenue', type: 'LIABILITY', subtype: 'other_current_liability' },
  { code: '2500', name: 'Loans Payable', type: 'LIABILITY', subtype: 'long_term_liability' },

  // Equity
  { code: '3000', name: 'Owner Investment / Drawings', type: 'EQUITY', subtype: 'owner_equity' },
  { code: '3900', name: 'Retained Earnings', type: 'EQUITY', subtype: 'retained_earnings', isSystem: true,
    description: 'Accumulated net income from closed periods.' },

  // Income
  { code: '4000', name: 'Sales', type: 'INCOME', subtype: 'operating_income', isSystem: true },
  { code: '4100', name: 'Service Revenue', type: 'INCOME', subtype: 'operating_income' },
  { code: '4900', name: 'Other Income', type: 'INCOME', subtype: 'other_income' },
  { code: '4910', name: 'Late Fee Income', type: 'INCOME', subtype: 'late_fee_income', isSystem: true },

  // Cost of goods sold (expense subtype so P&L can show gross profit)
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subtype: 'cogs' },
  { code: '5100', name: 'Subcontracted Services', type: 'EXPENSE', subtype: 'cogs' },

  // Operating expenses
  { code: '6000', name: 'Advertising & Marketing', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6100', name: 'Bank Fees', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6200', name: 'Insurance', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6300', name: 'Office Supplies', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6400', name: 'Professional Fees', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6500', name: 'Rent', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6600', name: 'Software & Subscriptions', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6700', name: 'Travel & Meals', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6800', name: 'Utilities', type: 'EXPENSE', subtype: 'operating_expense' },
  { code: '6900', name: 'Contractor Payments', type: 'EXPENSE', subtype: 'contractor',
    description: 'Payments to 1099-eligible contractors (feeds 1099 reporting in Phase 4).' },
  { code: '6950', name: 'Miscellaneous Expense', type: 'EXPENSE', subtype: 'operating_expense' },
];
