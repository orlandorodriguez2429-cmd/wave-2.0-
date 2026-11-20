// The office's legal identity and the version of the privacy notice + terms.
// Identity comes from environment variables so personal details are never
// committed to the repository. Bump TERMS_VERSION whenever /privacy or
// /terms change in substance: everyone is asked to accept again.
export const TERMS_VERSION = '2026-11-20';
export const TERMS_EFFECTIVE = 'November 20, 2026';

export interface FirmIdentity {
  legalName: string;
  address: string;
  email: string;
  phone: string;
  state: string;
  website: string;
  complete: boolean;
}

export function firmIdentity(env: Record<string, string | undefined> = process.env): FirmIdentity {
  const v = (k: string) => env[k]?.trim() || '';
  const legalName = v('FIRM_LEGAL_NAME');
  const address = v('FIRM_ADDRESS');
  const email = v('FIRM_PRIVACY_EMAIL');
  return {
    legalName: legalName || 'Your Tax Solution',
    address: address || '[office address — set FIRM_ADDRESS]',
    email: email || '[privacy contact email — set FIRM_PRIVACY_EMAIL]',
    phone: v('FIRM_PHONE'),
    state: v('FIRM_STATE') || 'Florida',
    website: v('FIRM_WEBSITE') || 'https://www.yourtax-solution.com',
    complete: !!(legalName && address && email),
  };
}

export const needsConsent = (u: { termsVersion: string | null }) => u.termsVersion !== TERMS_VERSION;
