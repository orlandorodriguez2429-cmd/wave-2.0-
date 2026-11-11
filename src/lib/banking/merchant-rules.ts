// Built-in merchant rules: the second step of auto-categorization, after a
// business's own rules and before the AI. Deliberately plain patterns so
// every automatic decision is explainable ("matched built-in rule: AWS").
//
// Balance-sheet rules matter as much as P&L ones: credit card payments,
// sales tax remittances, owner draws/contributions and loan money must NOT
// land on the P&L. Loan *payments* are never auto-posted — they need an
// interest/principal split, so they're only suggested.

export type Direction = 'INFLOW' | 'OUTFLOW';

export interface MerchantRule {
  name: string;
  pattern: RegExp;
  /** Chart-of-accounts code from the standard template. */
  accountCode: string;
  direction?: Direction;
  /** Only for rows on this kind of feed account. */
  feedKind?: 'depository' | 'credit';
  /** Suggest only; a person must finish it (e.g. interest split). */
  suggestOnly?: string;
}

const w = (words: string) => new RegExp(`\\b(?:${words})\\b`, 'i');

export const MERCHANT_RULES: MerchantRule[] = [
  // --- Balance sheet -----------------------------------------------------------
  { name: 'Credit card payment', pattern: /(CREDIT CA?RD|CRD|CARD)\s*(\d{4}\s*)?(E?PAYMENT|PMT|AUTOPAY)|AUTOPAY PAYMENT|EPAYMENT|PAYMENT TO (CHASE|AMEX|CITI|DISCOVER|CAPITAL ONE)/i, accountCode: '2100', direction: 'OUTFLOW', feedKind: 'depository' },
  { name: 'Sales tax payment', pattern: /SALES (AND USE )?TAX|(DEPT|DEPARTMENT) OF (REVENUE|TAXATION)|CDTFA|COMPTROLLER/i, accountCode: '2200', direction: 'OUTFLOW' },
  { name: 'Owner draw', pattern: /OWNER'?S? DRAW|DRAW TO OWNER|OWNER DISTRIBUTION/i, accountCode: '3000', direction: 'OUTFLOW' },
  { name: 'Owner contribution', pattern: /OWNER'?S? (CONTRIBUTION|INVESTMENT)|CAPITAL CONTRIBUTION/i, accountCode: '3000', direction: 'INFLOW' },
  { name: 'Loan proceeds', pattern: /LOAN (PROCEEDS|DISBURSEMENT|FUNDING)|SBA EIDL|LINE OF CREDIT ADVANCE/i, accountCode: '2500', direction: 'INFLOW' },
  { name: 'Loan payment', pattern: /LOAN (PAYMENT|PMT)|SBA LOAN|MORTGAGE PMT|AUTO LOAN|EQUIPMENT LOAN/i, accountCode: '2500', direction: 'OUTFLOW', suggestOnly: 'Loan payment: enter the interest part so only principal reduces the loan.' },

  // --- Income ------------------------------------------------------------------------
  { name: 'Card processor payout', pattern: /STRIPE (PAYOUT|TRANSFER)|SQUARE (INC|DEPOSIT)|SHOPIFY PAYOUT|PAYPAL TRANSFER|CLOVER DEP/i, accountCode: '4000', direction: 'INFLOW' },
  { name: 'Interest earned', pattern: /INTRST PYMNT|INTEREST (PAID|EARNED|PAYMENT)/i, accountCode: '4900', direction: 'INFLOW' },

  // --- Expenses -----------------------------------------------------------------------
  { name: 'Software & subscriptions', pattern: w('AWS|AMAZON WEB SERVICES|GITHUB|GOOGLE \\*?(?:WORKSPACE|GSUITE|CLOUD)|MICROSOFT|MSFT|ADOBE|DROPBOX|SLACK|ZOOM\\.US|ZOOM|INTUIT|QUICKBOOKS|NOTION|ATLASSIAN|OPENAI|ANTHROPIC|CANVA|DOCUSIGN|MAILCHIMP'), accountCode: '6600', direction: 'OUTFLOW' },
  { name: 'Travel & meals', pattern: w('DELTA AIR|DELTA|UNITED AIRLINES|AMERICAN AIR(?:LINES)?|SOUTHWEST|JETBLUE|ALASKA AIR|UBER|LYFT|MARRIOTT|HILTON|HYATT|AIRBNB|EXPEDIA|STARBUCKS|MCDONALD\'?S|CHIPOTLE|DOORDASH|GRUBHUB'), accountCode: '6700', direction: 'OUTFLOW' },
  { name: 'Office supplies & postage', pattern: w('STAPLES|OFFICE DEPOT|OFFICEMAX|USPS|FEDEX|UPS STORE|UPS'), accountCode: '6300', direction: 'OUTFLOW' },
  { name: 'Utilities & phone', pattern: w('COMCAST|XFINITY|VERIZON|AT&T|T-MOBILE|SPECTRUM|PG&E|CON ED|DUKE ENERGY|FPL|WATER UTIL'), accountCode: '6800', direction: 'OUTFLOW' },
  { name: 'Bank fees', pattern: /SERVICE (FEE|CHARGE)|MONTHLY (MAINTENANCE )?FEE|OVERDRAFT|WIRE (TRANSFER )?FEE|NSF FEE|FOREIGN TRANSACTION FEE/i, accountCode: '6100', direction: 'OUTFLOW' },
  { name: 'Insurance', pattern: w('GEICO|STATE FARM|PROGRESSIVE|ALLSTATE|HISCOX|NEXT INSURANCE|THE HARTFORD'), accountCode: '6200', direction: 'OUTFLOW' },
  { name: 'Advertising', pattern: /FACEBK|META ADS|GOOGLE \*?ADS|LINKEDIN ADS|YELP ADS/i, accountCode: '6000', direction: 'OUTFLOW' },
  { name: 'Rent', pattern: /\bRENT\b|WEWORK|REGUS/i, accountCode: '6500', direction: 'OUTFLOW' },
];

const REFUND = /\b(REFUND|RETURN|CREDIT VOUCHER|REVERSAL)\b/i;

export function matchMerchantRule(
  description: string,
  amount: bigint,
  feedKind: string | null,
): MerchantRule | null {
  const direction: Direction = amount < 0n ? 'OUTFLOW' : 'INFLOW';
  // A refund from a merchant reduces the same expense it was bought under.
  const refund = direction === 'INFLOW' && REFUND.test(description);
  for (const rule of MERCHANT_RULES) {
    const expenseRule = rule.direction === 'OUTFLOW' && /^[5-7]/.test(rule.accountCode);
    if (rule.direction && rule.direction !== direction && !(refund && expenseRule)) continue;
    if (rule.feedKind && feedKind && rule.feedKind !== feedKind) continue;
    if (rule.pattern.test(description)) return rule;
  }
  return null;
}
