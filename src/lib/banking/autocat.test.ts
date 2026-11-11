// Pure pieces of auto-categorization: privacy cleaning, merchant rules, payee keys.
import { describe, expect, it } from 'vitest';
import { cleanDescription } from './ai-categorize';
import { matchMerchantRule } from './merchant-rules';
import { payeeKey } from './categorize';

describe('cleanDescription (what may leave the server)', () => {
  it('drops the counterparty of person-to-person payments', () => {
    expect(cleanDescription('ZELLE TO JOHN SMITH 8812')).toBe('ZELLE TO [person]');
    expect(cleanDescription('Venmo payment Maria Lopez')).toBe('Venmo payment [person]');
    expect(cleanDescription('CHECK 1043 JOE PLUMBER')).toBe('CHECK [person]');
    expect(cleanDescription('ONLINE TRANSFER FROM JANE DOE REF 99381')).toBe('ONLINE TRANSFER FROM [person]');
  });
  it('masks account and reference numbers', () => {
    expect(cleanDescription('ACH DEBIT ACCT 000123456789 ADP PAYROLL')).toBe('ACH DEBIT ACCT [number] ADP PAYROLL');
    expect(cleanDescription('CARD XXXX4321 SHELL OIL')).toBe('CARD [number] SHELL OIL');
    expect(cleanDescription('AMZN Mktp US*2K4AB19')).toBe('AMZN Mktp US*[ref]');
  });
  it('removes emails and URL paths but keeps merchant domains', () => {
    expect(cleanDescription('INVOICE bob.smith@gmail.com')).toBe('INVOICE [email]');
    expect(cleanDescription('AWS EMEA aws.amazon.com/billing?id=9')).toBe('AWS EMEA aws.amazon.com');
  });
  it('adds the Plaid merchant name (a business) when it is not already there', () => {
    expect(cleanDescription('SQ *BLUE BOTTLE 0393', 'Blue Bottle Coffee')).toBe('SQ *BLUE BOTTLE [number] (merchant: Blue Bottle Coffee)');
    expect(cleanDescription('Uber 063015 SF**POOL**', 'Uber')).toBe('Uber [number] SF**POOL**');
    // Never added to a person-to-person payment.
    expect(cleanDescription('ZELLE TO JOHN SMITH', 'John Smith')).toBe('ZELLE TO [person]');
  });
});

describe('merchant rules', () => {
  const m = (d: string, amt: bigint, kind = 'depository') => matchMerchantRule(d, amt, kind)?.accountCode ?? null;
  it('routes balance-sheet items off the P&L', () => {
    expect(m('CHASE CREDIT CRD AUTOPAY', -50000n)).toBe('2100');
    expect(m('CREDIT CARD 3333 PAYMENT *//', -2500n)).toBe('2100'); // Plaid sandbox wording
    expect(m('CA DEPT OF TAX AND FEE ADMIN CDTFA', -12000n)).toBe('2200');
    expect(m('OWNER DRAW', -100000n)).toBe('3000');
    expect(m('OWNER CONTRIBUTION', 100000n)).toBe('3000');
    expect(m('SBA EIDL LOAN PROCEEDS', 5000000n)).toBe('2500');
    expect(matchMerchantRule('SBA LOAN PMT 0042', -150000n, 'depository')?.suggestOnly).toBeTruthy();
  });
  it('respects direction and feed kind', () => {
    expect(m('STRIPE PAYOUT ST-1', 10000n)).toBe('4000');
    expect(m('STRIPE PAYOUT ST-1', -10000n)).toBeNull();
    expect(m('CREDIT CARD PAYMENT', -10000n, 'credit')).toBeNull();
  });
  it('knows common expense merchants', () => {
    expect(m('AWS EMEA aws.amazon.com', -18742n)).toBe('6600');
    expect(m('DELTA AIR 0062341', -45620n)).toBe('6700');
    expect(m('OFFICE DEPOT #1123', -8433n)).toBe('6300');
    expect(m('MONTHLY MAINTENANCE FEE', -1500n)).toBe('6100');
    expect(m('MAYA DESIGN CO INV 88', -90000n)).toBeNull();
  });
  it('a merchant refund goes back to the same expense', () => {
    expect(m('United Airlines **** REFUND ****', 50000n)).toBe('6700');
    expect(m('OFFICE DEPOT RETURN #1123', 2500n)).toBe('6300');
    expect(m('UNITED AIRLINES', 50000n)).toBeNull(); // money in without "refund" is not assumed
  });
});

describe('payeeKey', () => {
  it('keeps the stable merchant words', () => {
    expect(payeeKey('POS DEBIT MAYA DESIGN CO INV 88 05/10')).toBe('MAYA DESIGN CO');
    expect(payeeKey('HOME DEPOT #4411 ATLANTA GA')).toBe('HOME DEPOT ATLANTA');
  });
});
