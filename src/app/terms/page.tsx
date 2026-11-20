// Terms of use for the client portal and staff application. Have your
// attorney review before relying on them. Identity from FIRM_* variables.
import { firmIdentity, TERMS_EFFECTIVE } from '@/lib/legal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Terms of use · Your Tax Solution Books' };

export default function TermsPage() {
  const f = firmIdentity();
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <article className="mx-auto max-w-2xl px-6 py-10 space-y-4 text-sm leading-6 text-slate-700">
        <h1 className="text-2xl font-semibold text-slate-900">Terms of use</h1>
        <p className="text-slate-500">{f.legalName} · Effective {TERMS_EFFECTIVE}</p>

        <h2 className="font-semibold text-slate-900">1. What this is</h2>
        <p>
          Your Tax Solution Books (the &quot;Service&quot;) is the system {f.legalName} (&quot;we&quot;) uses to keep clients&apos;
          books, produce Profit &amp; Loss reports and prepare Forms 1099. Access is by invitation only, for our clients and
          staff. These terms add to — and do not replace — your engagement letter with us. If they conflict, the engagement
          letter controls.
        </p>

        <h2 className="font-semibold text-slate-900">2. Your account</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Keep your password and your two-step verification device private. Do not share your login.</li>
          <li>Tell us right away at {f.email} if you think someone else has used your account or you lose your device.</li>
          <li>We may suspend access to protect your information or the Service.</li>
        </ul>

        <h2 className="font-semibold text-slate-900">3. Bank connections</h2>
        <p>
          You may connect business bank and card accounts through Plaid. By doing so you authorize us to receive account
          names, the last 4 digits, balances and transactions for those accounts for bookkeeping and tax preparation, and
          you agree to Plaid&apos;s{' '}
          <a className="text-teal-700 underline" href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noreferrer">End User Privacy Policy</a>.
          The Service only reads data; it cannot move money. You can disconnect at any time.
        </p>

        <h2 className="font-semibold text-slate-900">4. Your information and our work</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>You are responsible for giving us complete and accurate information and for telling us about transactions the bank data does not show.</li>
          <li>Transactions are categorized by rules and, for unclear items, with the help of an AI service that sees only masked data. We review the results; automated categories are not tax advice.</li>
          <li>The portal shows your books as of the time you view them. Reports are final only when we deliver them to you as part of our engagement.</li>
          <li>Nothing in the Service is legal advice. Tax advice is provided only under your engagement letter.</li>
        </ul>

        <h2 className="font-semibold text-slate-900">5. Privacy and security</h2>
        <p>
          How we collect, use, share and protect information is described in our{' '}
          <a className="text-teal-700 underline" href="/privacy">Privacy notice</a>, which is part of these terms.
        </p>

        <h2 className="font-semibold text-slate-900">6. Acceptable use</h2>
        <p>Do not try to access another client&apos;s data, probe or disrupt the Service, or upload anything unlawful or malicious.</p>

        <h2 className="font-semibold text-slate-900">7. Availability and liability</h2>
        <p>
          We work to keep the Service available and secure but do not guarantee it will be uninterrupted or error-free. To
          the extent the law allows, our responsibility for the Service is limited as set out in your engagement letter.
        </p>

        <h2 className="font-semibold text-slate-900">8. Ending access</h2>
        <p>
          When our engagement ends we will turn off portal access. We keep records for the retention period described in
          the Privacy notice, and you may ask for a copy of your records before access ends.
        </p>

        <h2 className="font-semibold text-slate-900">9. Changes and governing law</h2>
        <p>
          We may update these terms; we will ask you to accept the new version at your next sign-in. These terms are
          governed by the laws of the State of {f.state}.
        </p>
        <p>Questions: {f.email}</p>
        <p><a href="/login" className="text-teal-700 hover:underline">Back</a></p>
      </article>
    </div>
  );
}
