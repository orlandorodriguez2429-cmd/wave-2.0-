// 1099 box registry. A "box code" identifies form + box; vendor payments
// accrue against one box each. NEC/MISC are fully supported; INT/DIV are
// stubbed (tracked and totaled, form generation arrives with demand).

export type FormKind = 'NEC' | 'MISC' | 'INT' | 'DIV';

export interface BoxDef {
  code: string;
  form: FormKind;
  box: string;
  label: string;
  /** Which threshold from TaxYearConfig applies. */
  thresholdKey: 'necMisc' | 'int' | 'div';
}

export const BOXES: BoxDef[] = [
  { code: 'NEC_1', form: 'NEC', box: '1', label: 'Nonemployee compensation', thresholdKey: 'necMisc' },
  { code: 'MISC_1', form: 'MISC', box: '1', label: 'Rents', thresholdKey: 'necMisc' },
  { code: 'MISC_2', form: 'MISC', box: '2', label: 'Royalties', thresholdKey: 'necMisc' },
  { code: 'MISC_3', form: 'MISC', box: '3', label: 'Other income', thresholdKey: 'necMisc' },
  { code: 'INT_1', form: 'INT', box: '1', label: 'Interest income', thresholdKey: 'int' },
  { code: 'DIV_1A', form: 'DIV', box: '1a', label: 'Ordinary dividends', thresholdKey: 'div' },
];

export const BOX_BY_CODE = new Map(BOXES.map((b) => [b.code, b]));

export function boxLabel(code: string): string {
  const box = BOX_BY_CODE.get(code);
  return box ? `1099-${box.form} box ${box.box} (${box.label})` : code;
}
