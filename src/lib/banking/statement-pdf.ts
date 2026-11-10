// PDF bank statements → the same rows a CSV gives. Bank PDFs differ a lot,
// so this is deliberately conservative:
//   * text is rebuilt into lines from positioned text items;
//   * a transaction line starts with a date and ends with an amount
//     (optionally followed by a running balance);
//   * the sign comes from, in order: the running balance (most reliable), an
//     explicit minus/parentheses, the section the line sits in
//     ("Deposits…" vs "Withdrawals… / Checks… / Fees…"), or — on statements
//     that sign their withdrawals — no sign meaning money in;
//   * a line whose sign can't be determined fails the whole file.
// The opening/closing balance check in importStatement() is the final guard:
// if the parse is off by a single cent, nothing is imported.
import { extractTextItems } from 'unpdf';
import { LedgerValidationError } from '@/lib/ledger/validate';
import { parseMoneyCell, type StatementRow } from './statement';

export interface PdfStatement {
  rows: StatementRow[];
  openingBalance: bigint | null;
  closingBalance: bigint | null;
}

/** Rebuild visual lines (top to bottom, left to right) from a PDF. */
export async function pdfToLines(data: Uint8Array): Promise<string[]> {
  const { items } = await extractTextItems(data);
  const lines: string[] = [];
  for (const page of items) {
    const rows: Array<{ y: number; parts: Array<{ x: number; s: string }> }> = [];
    for (const it of page) {
      if (!it.str.trim()) continue;
      const row = rows.find((r) => Math.abs(r.y - it.y) <= 2.5);
      if (row) row.parts.push({ x: it.x, s: it.str });
      else rows.push({ y: it.y, parts: [{ x: it.x, s: it.str }] });
    }
    rows.sort((a, b) => b.y - a.y); // PDF y grows upwards
    for (const r of rows) {
      lines.push(
        r.parts
          .sort((a, b) => a.x - b.x)
          .map((p) => p.s.trim())
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    }
  }
  return lines;
}

const MONEY = String.raw`\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?`;
// The date may run straight into the description: PDF text extraction can
// merge adjacent text ("01/06/2027GEICO …").
const TXN = new RegExp(String.raw`^(\d{1,2}/\d{1,2}(?:/\d{4}|/\d{2}(?!\d))?)(?=\s|[A-Za-z#*])\s*(.+?)\s+(${MONEY})(?:\s+(${MONEY}))?$`);
const DEPOSIT_SECTION = /\b(deposits?|credits?|additions|money in)\b/i;
const WITHDRAWAL_SECTION = /\b(withdrawals?|debits?|checks?( paid)?|fees?|subtractions|purchases|payments|charges|money out)\b/i;
const OPENING = new RegExp(String.raw`\b(beginning|opening|previous|starting) balance\b.*?(${MONEY})`, 'i');
const CLOSING = new RegExp(String.raw`\b(ending|closing|new) balance\b.*?(${MONEY})`, 'i');

function yearHint(lines: string[]): { year: number; endMonth: number } | null {
  // "Statement period 09/01/2026 - 09/30/2026", "through September 30, 2026", …
  const full = lines.join(' ');
  const dates = [...full.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)].map((m) => ({ m: Number(m[1]), y: Number(m[3]) }));
  if (dates.length) {
    const last = dates[dates.length - 1];
    return { year: last.y, endMonth: last.m };
  }
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const named = [...full.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+(\d{4})/gi)];
  if (named.length) {
    const last = named[named.length - 1];
    return { year: Number(last[2]), endMonth: months.indexOf(last[1].toLowerCase()) + 1 };
  }
  return null;
}

export function parseStatementLines(lines: string[], currency: string): PdfStatement {
  const hint = yearHint(lines);
  let section: 1 | -1 | 0 = 0;
  let balance: bigint | null = null;
  let opening: bigint | null = null;
  let closing: bigint | null = null;
  const rows: StatementRow[] = [];
  // Statements that print withdrawals with a minus/parentheses use unsigned
  // amounts for money in.
  const usesSigns = lines.some((l) => {
    const m = TXN.exec(l);
    return !!m && (parseMoneyCell(m[3], currency) ?? 0n) < 0n;
  });

  for (const line of lines) {
    const open = OPENING.exec(line);
    if (open) {
      opening = parseMoneyCell(open[2], currency);
      balance = opening;
      continue;
    }
    const close = CLOSING.exec(line);
    if (close) {
      closing = parseMoneyCell(close[2], currency);
      continue;
    }
    const m = TXN.exec(line);
    if (!m) {
      // A heading switches the section (but not a "Total deposits" line).
      if (!/\btotal\b/i.test(line) && line.length < 60) {
        if (WITHDRAWAL_SECTION.test(line)) section = -1;
        else if (DEPOSIT_SECTION.test(line)) section = 1;
      }
      continue;
    }
    const [, dateRaw, descRaw, amountRaw, balanceRaw] = m;
    const description = descRaw.trim();
    if (/\b(total|subtotal)\b/i.test(description)) continue;

    // Date: add the year from the statement period when missing.
    const [mm, dd, yy] = dateRaw.split('/');
    let year: number;
    if (yy) year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    else if (hint) year = Number(mm) > hint.endMonth ? hint.year - 1 : hint.year; // Dec lines on a Jan statement
    else throw new LedgerValidationError('Could not tell which year this statement is for. Upload the CSV export instead.');
    const date = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;

    const magnitude = parseMoneyCell(amountRaw, currency)!;
    const explicit = magnitude < 0n; // minus sign, trailing minus or parentheses
    const abs = magnitude < 0n ? -magnitude : magnitude;
    let amount: bigint;
    const newBalance = balanceRaw ? parseMoneyCell(balanceRaw, currency) : null;
    if (newBalance !== null && balance !== null) {
      const delta = newBalance - balance;
      if (delta !== abs && delta !== -abs) {
        throw new LedgerValidationError(`Line "${line}" doesn't match the running balance. Upload the CSV export instead.`);
      }
      amount = delta;
    } else if (explicit) {
      amount = magnitude;
    } else if (section !== 0) {
      amount = section === 1 ? abs : -abs;
    } else if (usesSigns) {
      amount = abs;
    } else {
      throw new LedgerValidationError(`Could not tell if "${description}" is money in or out. Upload the CSV export instead.`);
    }
    if (newBalance !== null) balance = newBalance;
    else if (balance !== null) balance += amount;
    if (amount !== 0n) rows.push({ date, description, amount });
  }

  if (rows.length === 0) {
    throw new LedgerValidationError('No transactions could be read from this PDF (it may be a scanned image). Upload the CSV export instead.');
  }
  return { rows, openingBalance: opening, closingBalance: closing };
}

export async function parseStatementPdf(data: Uint8Array, currency: string): Promise<PdfStatement> {
  let lines: string[];
  try {
    lines = await pdfToLines(data);
  } catch {
    throw new LedgerValidationError('That file could not be opened as a PDF.');
  }
  return parseStatementLines(lines, currency);
}
