// E-file transmitters behind one interface, per the brief's two paths:
//  1. Third-party provider API (Track1099/Tax1099-style) — fastest to market.
//     The sandbox MockTransmitter stands in for it and exercises the whole
//     submit → accept lifecycle.
//  2. Direct IRS IRIS A2A — for businesses holding their own Transmitter
//     Control Code (TCC; the application takes ~45 business days). Stubbed
//     until IRIS_TCC + credentials are configured. IRIS replaced the retired
//     FIRE system and is required for TY2026+ filings.
//
// HARD RULE (PROJECT.md): nothing in this module is ever called without an
// explicit human "Submit to IRS" confirmation upstream.

export interface FilingRecipient {
  name: string;
  tin: string; // full TIN, decrypted just-in-time by the caller
  tinType: string;
  addressLine: string;
}

export interface FilingPayload {
  formId: string;
  taxYear: number;
  formKind: string;
  payer: { name: string; ein: string; addressLine: string };
  recipient: FilingRecipient;
  /** Box number -> minor units. */
  amounts: Record<string, string>;
  /** Set when this filing corrects a previously accepted one. */
  correctsSubmissionId?: string;
}

export interface SubmitResult {
  submissionId: string;
  status: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  message?: string;
}

export interface EfileTransmitter {
  readonly name: string;
  submit(payloads: FilingPayload[]): Promise<SubmitResult[]>;
  checkStatus(submissionId: string): Promise<SubmitResult>;
}

export class MockTransmitter implements EfileTransmitter {
  readonly name = 'mock';

  async submit(payloads: FilingPayload[]): Promise<SubmitResult[]> {
    return payloads.map((p) => {
      // Deterministic sandbox validation: a payload without a 9-digit TIN is
      // rejected, mirroring the most common real-world rejection.
      const ok = /^\d{9}$/.test(p.recipient.tin) && /^\d{9}$/.test(p.payer.ein);
      return {
        submissionId: `MOCK-${p.taxYear}-${p.formId.slice(-8)}`,
        status: ok ? 'ACCEPTED' : 'REJECTED',
        message: ok ? 'Accepted by sandbox transmitter.' : 'Invalid TIN/EIN format.',
      };
    });
  }

  async checkStatus(submissionId: string): Promise<SubmitResult> {
    return { submissionId, status: 'ACCEPTED' };
  }
}

export class IrisTransmitter implements EfileTransmitter {
  readonly name = 'iris';

  private notConfigured(): never {
    throw new Error(
      'Direct IRIS e-file is not configured. It requires your own Transmitter Control Code ' +
        '(IRIS TCC application takes ~45 business days) plus IRIS_TCC / IRIS_CLIENT_ID / IRIS_CLIENT_SECRET. ' +
        'Use the provider transmitter until then.',
    );
  }

  async submit(): Promise<never> {
    if (!process.env.IRIS_TCC) this.notConfigured();
    // Real implementation: assemble the IRIS A2A XML/JSON payload, sign in
    // via the A2A OAuth flow, transmit, poll acknowledgements.
    this.notConfigured();
  }

  async checkStatus(): Promise<never> {
    this.notConfigured();
  }
}

export function getTransmitter(name: string): EfileTransmitter {
  if (name === 'iris') return new IrisTransmitter();
  return new MockTransmitter();
}

// Combined Federal/State Filing program participants (VERIFY yearly against
// IRS Pub. 1220 — configuration, not law): states here receive data through
// CF/SF; the rest either have no income tax or require separate direct filing.
export const CFSF_STATES = new Set([
  'AL','AZ','AR','CA','CO','CT','DE','GA','HI','ID','IN','KS','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NJ','NM','NC','ND','OH','OK','SC','WI',
]);

// States commonly requiring direct 1099 filing outside CF/SF (verify yearly).
export const DIRECT_FILE_STATES = new Set(['IA', 'KY', 'OR', 'PA', 'RI', 'UT', 'VA', 'VT', 'WV', 'DC', 'IL', 'NY']);

export function stateFilingNote(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = state.toUpperCase();
  if (CFSF_STATES.has(s)) return `${s} participates in CF/SF — federal e-file forwards state data.`;
  if (DIRECT_FILE_STATES.has(s)) return `${s} requires separate direct state filing — CF/SF does not cover it.`;
  return null;
}
