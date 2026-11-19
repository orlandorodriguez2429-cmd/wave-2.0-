// Plaid → internal mapping: sign flip, integer cents, description choice.
import { describe, expect, it } from 'vitest';
import { mapPlaidTransaction, plaidAmountToMinor } from './plaid';
import { FIXTURES, ACCOUNT_IDS } from './__fixtures__/fixture-provider';

describe('plaidAmountToMinor', () => {
  it('flips Plaid sign (positive = money out) into negative minor units', () => {
    expect(plaidAmountToMinor(5.4, 'USD')).toBe(-540n);
    expect(plaidAmountToMinor(500, 'USD')).toBe(-50000n);
  });
  it('maps money in (negative in Plaid) to positive minor units', () => {
    expect(plaidAmountToMinor(-4.22, 'USD')).toBe(422n);
    expect(plaidAmountToMinor(-1000, 'USD')).toBe(100000n);
  });
  it('is exact for values that are inexact as binary floats', () => {
    expect(plaidAmountToMinor(0.1 + 0.2, 'USD')).toBe(-30n);
    expect(plaidAmountToMinor(1.005, 'USD')).toBe(-100n); // 1.005 is 1.00499… as a double; Plaid never sends 3 decimals
    expect(plaidAmountToMinor(89.4, 'USD')).toBe(-8940n);
  });
});

describe('mapPlaidTransaction', () => {
  it('maps a fixture transaction', () => {
    const t = mapPlaidTransaction(FIXTURES.page1.added[0]);
    expect(t).toMatchObject({
      externalId: 'txn_uber_1',
      externalAccountId: ACCOUNT_IDS.checking,
      date: '2026-10-01',
      description: 'Uber 063015 SF**POOL**',
      amount: -540n,
      currency: 'USD',
      pending: false,
      merchantName: 'Uber',
      providerCategory: 'TRANSPORTATION',
    });
  });
  it('prefers the original bank description when Plaid provides it', () => {
    const t = mapPlaidTransaction(FIXTURES.page2.added[1]);
    expect(t.description).toBe('INTRST PYMNT 10/06');
    expect(t.amount).toBe(422n);
  });
  it('keeps the pending flag', () => {
    expect(mapPlaidTransaction(FIXTURES.page1.added[3]).pending).toBe(true);
  });
});
