// AI fallback for categorization (step 3, after the business's own rules and
// the built-in merchant rules).
//
// PRIVACY — what is sent, and nothing else:
//   * a cleaned description (see cleanDescription: digit runs, emails, URLs
//     and the counterparty of person-to-person payments are removed),
//   * signed amount, date, money in/out, bank vs credit card, Plaid's coarse
//     category (e.g. "TRANSFER_IN"),
//   * the business type the accountant typed (e.g. "residential cleaning"),
//   * the business's category list (code + name).
// Never: business or client names, emails, account numbers/masks, TINs,
// SSNs, institution names, or our database ids (items are numbered 1..n).
//
// Failure is safe: no key, timeout, API error, refusal or unparsable output
// all mean "no AI guess" and the transaction simply waits for review.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const AI_MODEL = 'claude-opus-5-5';
export const AUTO_APPLY_CONFIDENCE = 0.85;
const BATCH_SIZE = 25;
const TIMEOUT_MS = 30_000;

export interface AiItem {
  description: string;
  /** Signed decimal string, e.g. "-12.50" (negative = money out). */
  amount: string;
  date: string;
  direction: 'money in' | 'money out';
  feed: 'bank account' | 'credit card';
  bankCategory: string | null;
}

export interface AiCategory {
  code: string;
  name: string;
  type: string;
}

export interface AiGuess {
  /** Index into the items passed in. */
  index: number;
  accountCode: string | null;
  confidence: number;
  reason: string;
}

export type Classifier = (input: {
  businessType: string | null;
  categories: AiCategory[];
  items: AiItem[];
}) => Promise<AiGuess[]>;

// --- Cleaning (pure, unit-tested) ------------------------------------------------

const P2P =
  /\b(?:ZELLE|VENMO|CASH ?APP|APPLE CASH|PAYPAL \*?INST XFER|SQC\*)(?:\s+(?:PAYMENT|PMT))?(?:\s+(?:TO|FROM))?|\b(?:WIRE|ACH(?: CREDIT| DEBIT)?|TRANSFER|PAYMENT|DEPOSIT)\s+(?:TO|FROM)\b|\b(?:CHECK|CHK)\b/i;

/**
 * Remove anything that could identify a person or an account before a
 * description leaves the server.
 *   "ZELLE TO JOHN SMITH 8812"           → "ZELLE TO [person]"
 *   "ACH DEBIT ACCT 000123456789 ADP"    → "ACH DEBIT ACCT [number] ADP"
 *   "AMZN Mktp US*2K4 bob@x.com"          → "AMZN Mktp US*[ref] [email]"
 */
export function cleanDescription(raw: string, merchantName?: string | null): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
  s = s.replace(/\b(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|net|org|io|co)\b\S*/gi, (m) =>
    // Keep well-known merchant domains (aws.amazon.com is useful signal);
    // drop paths/query strings that may carry ids.
    m.split('/')[0].replace(/^https?:\/\//i, ''),
  );
  s = s.replace(/\*(?=[A-Z]*\d)[A-Z0-9]{4,}/gi, '*[ref]');
  s = s.replace(/\b[X*]{2,}\d{2,}\b/gi, '[number]');
  s = s.replace(/[#]?\d[\d\s-]{2,}\d/g, '[number]');
  const p2p = P2P.exec(s);
  if (p2p) {
    // Everything after the P2P keyword is a counterparty (often a person).
    s = `${s.slice(0, p2p.index + p2p[0].length)} [person]`;
  }
  // Plaid's merchant name is a business, not a person — safe and useful.
  if (merchantName && !p2p && !s.toLowerCase().includes(merchantName.toLowerCase())) {
    s = `${s} (merchant: ${merchantName})`;
  }
  return s.slice(0, 200);
}

// --- Anthropic classifier -------------------------------------------------------------

const ResultSchema = z.object({
  results: z.array(
    z.object({
      item: z.number().int(),
      account_code: z.string().nullable(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
});

const SYSTEM = `You categorize small-business bank and credit card transactions for a bookkeeper.
For each numbered transaction, pick the single best account code from the provided chart of accounts, or null if none fits or it is genuinely unclear.

Bookkeeping rules:
- Transfers between the business's own accounts, credit card payments, owner draws and contributions, loan proceeds, loan principal, and sales tax remittances belong on balance-sheet accounts (asset, liability or equity), never on income or expense.
- Money in from customers is income; money out for business costs is an expense.
- Person-to-person payments ("[person]") are ambiguous: give low confidence unless the amount pattern and business type make it clear.

confidence is your probability (0 to 1) that a careful bookkeeper would choose the same account. Use 0.85 or higher only when you are nearly certain. reason is one short sentence.`;

export function createAnthropicClassifier(apiKey = process.env.ANTHROPIC_API_KEY): Classifier | null {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });

  return async ({ businessType, categories, items }) => {
    const guesses: AiGuess[] = [];
    for (let start = 0; start < items.length; start += BATCH_SIZE) {
      const batch = items.slice(start, start + BATCH_SIZE);
      const chart = categories.map((c) => `${c.code} | ${c.name} | ${c.type}`).join('\n');
      const lines = batch
        .map((t, i) =>
          JSON.stringify({ item: i + 1, ...t }),
        )
        .join('\n');
      try {
        const response = await client.beta.messages.parse({
          model: AI_MODEL,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low', format: betaZodOutputFormat(ResultSchema) },
          system: SYSTEM,
          messages: [
            {
              role: 'user',
              content: `Business type: ${businessType?.trim() || 'small business (type not given)'}\n\nChart of accounts (code | name | type):\n${chart}\n\nTransactions:\n${lines}`,
            },
          ],
        });
        if (response.stop_reason === 'refusal' || !response.parsed_output) continue;
        for (const r of response.parsed_output.results) {
          const idx = r.item - 1;
          if (idx < 0 || idx >= batch.length) continue;
          guesses.push({
            index: start + idx,
            accountCode: r.account_code,
            confidence: Math.max(0, Math.min(1, r.confidence)),
            reason: r.reason.slice(0, 300),
          });
        }
      } catch (err) {
        // Log the class only — never request content.
        console.warn(`[ai-categorize] batch failed: ${err instanceof Error ? err.name : 'unknown error'}`);
      }
    }
    return guesses;
  };
}
