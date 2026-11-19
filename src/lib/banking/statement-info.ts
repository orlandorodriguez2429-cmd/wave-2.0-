// Who and what a PDF statement is for, read from its header text: bank name,
// account holder (business), last 4 digits, checking vs credit card, and the
// statement period. Used by the statement inbox to file each statement under
// the right client and account. Everything is best-effort: fields that can't
// be read are null, and the inbox decides what to do without them.

export interface StatementInfo {
  bankName: string | null;
  holderName: string | null;
  mask: string | null;
  kind: 'depository' | 'credit';
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;
}

const BANK_WORDS =
  /\b(bank|credit union|federal savings|savings bank|chase|wells fargo|citi(bank)?|capital one|american express|amex|discover|pnc|truist|regions|santander|ally|navy federal|td bank|us bank|u\.s\. bank|bmo|citizens|fifth third|huntington|keybank|m&t|bank of america)\b/i;
const BUSINESS_SUFFIX = /\b(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|co\.|company|ltd\.?|pllc|llp|lp|dba)\b/i;
const NOT_A_HOLDER = /\b(statement|period|page|balance|deposits?|withdrawals?|member fdic|customer service|www\.|\.com|p\.?o\.? box)\b/i;
const CREDIT_HINTS = /\b(credit card|card ?member|minimum payment|payment due date|credit limit|available credit|new balance)\b/i;

function toIso(mdy: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(mdy.trim());
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function namedToIso(s: string): string | null {
  const m = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  if (!m) return null;
  return `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

export function readStatementInfo(lines: string[]): StatementInfo {
  const head = lines.slice(0, 25); // header area
  const text = lines.join('\n');

  // Last 4 digits: "Account ending in 4410", "Acct # ...4410", "Account Number XXXXXX4410", "Card ending 3012".
  let mask: string | null = null;
  const maskPatterns = [
    /\b(?:account|acct|card)\b[^\n\d]{0,40}?(?:ending|ends)\s*(?:in|with)?\s*[:#]?\s*[x*•.\s-]*(\d{4})\b/i,
    /\b(?:account|acct|card)\s*(?:number|no\.?|#)?\s*[:#]?\s*[x*•.\s-]{2,}(\d{4})\b/i,
    /\b(?:account|acct)\s*(?:number|no\.?|#)\s*[:#]?\s*\d{4,}(\d{4})\b/i,
    /\b[x*•]{4}[\s-]?[x*•]{4}[\s-]?[x*•]{4}[\s-]?(\d{4})\b/i,
  ];
  for (const p of maskPatterns) {
    const m = p.exec(text);
    if (m) {
      mask = m[1];
      break;
    }
  }

  // Bank: first header line with a bank word, cut before any "Statement…" text.
  let bankName: string | null = null;
  for (const l of head) {
    if (BANK_WORDS.test(l)) {
      bankName = l.split(/\s{2,}|\bstatement\b|\bperiod\b|\baccount\b/i)[0].trim().replace(/[,|]+$/, '') || null;
      if (bankName && bankName.length > 60) bankName = bankName.slice(0, 60);
      if (bankName) break;
    }
  }

  // Holder: a header line naming a business ("SUNRISE CLEANING LLC"), not the bank.
  let holderName: string | null = null;
  const labelled = /\b(?:account holder|prepared for|customer|business name)\s*[:\-]\s*(.+)$/i;
  for (const l of head) {
    const m = labelled.exec(l);
    if (m) {
      holderName = m[1].trim();
      break;
    }
  }
  if (!holderName) {
    for (const l of head) {
      if (!BUSINESS_SUFFIX.test(l) || NOT_A_HOLDER.test(l)) continue;
      if (bankName && l.trim().toLowerCase() === bankName.toLowerCase()) continue;
      if (BANK_WORDS.test(l) && !/\bllc|inc|corp/i.test(l)) continue;
      // Keep just the name part ("SUNRISE CLEANING LLC   Account ending 7781").
      const name = l.split(/\s{2,}|\baccount\b|\bacct\b/i)[0].trim();
      if (name.length >= 3 && name.length <= 80) {
        holderName = name;
        break;
      }
    }
  }
  if (holderName) holderName = tidyName(holderName);

  // Period: "Statement Period 10/01/2026 - 10/31/2026", "October 1, 2026 through October 31, 2026".
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  const numeric = /(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))\s*(?:-|–|to|through|thru)\s*(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))/i.exec(text);
  if (numeric) {
    periodStart = toIso(numeric[1]);
    periodEnd = toIso(numeric[2]);
  } else {
    const named = /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\s*(?:-|–|to|through|thru)\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i.exec(text);
    if (named) {
      periodStart = namedToIso(named[1]);
      periodEnd = namedToIso(named[2]);
    }
  }

  return { bankName, holderName, mask, kind: CREDIT_HINTS.test(text) ? 'credit' : 'depository', periodStart, periodEnd };
}

/** "SUNRISE CLEANING LLC" → "Sunrise Cleaning LLC". */
export function tidyName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Inc|Corp|Ltd|Pllc|Llp|Lp|Dba)\b/g, (w) => w.toUpperCase())
    .replace(/\bL\.l\.c\./g, 'L.L.C.');
}

/** Comparable form of a business name: "Sunrise Cleaning, L.L.C." → "sunrise cleaning". */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,'&]/g, ' ')
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|pllc|llp|lp|dba|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
