// Privacy notice. Written for a tax and bookkeeping office under the
// Gramm-Leach-Bliley Act (FTC Privacy Rule, 16 CFR 313 / Reg. P), IRC §7216,
// the FTC Safeguards Rule and the Florida Information Protection Act.
// Have your attorney review before relying on it. Office identity comes from
// FIRM_* environment variables (see src/lib/legal.ts).
import { firmIdentity, TERMS_EFFECTIVE } from '@/lib/legal';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Privacy notice · Your Tax Solution Books' };

export default function PrivacyPage() {
  const f = firmIdentity();
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <article className="mx-auto max-w-2xl px-6 py-10 space-y-4 text-sm leading-6 text-slate-700">
        <h1 className="text-2xl font-semibold text-slate-900">Privacy notice</h1>
        <p className="text-slate-500">
          {f.legalName} · {f.address} · {f.email}
          {f.phone ? ` · ${f.phone}` : ''} · Effective {TERMS_EFFECTIVE}
        </p>

        <h2 className="font-semibold text-slate-900">Facts: what we do with your personal information</h2>
        <p>
          Federal law gives consumers the right to limit some but not all sharing, and requires us to tell you how we
          collect, share and protect your personal information. Please read this notice carefully.
        </p>

        <h2 className="font-semibold text-slate-900">What we collect</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Contact and login details: name, email address, password (stored only as a one-way hash), and two-step verification settings.</li>
          <li>Your business&apos;s financial records: bank and card transactions, account names and the last 4 digits of account numbers, balances, statements you upload, categories, Profit &amp; Loss reports.</li>
          <li>Contractor information for 1099s: names, addresses and taxpayer identification numbers (stored encrypted).</li>
          <li>Security records: sign-ins, IP addresses and an activity log of who viewed or changed what.</li>
        </ul>
        <p><strong>We never receive</strong> your online-banking username or password, or your full bank account numbers. Bank sign-in happens through Plaid.</p>

        <h2 className="font-semibold text-slate-900">How we use it</h2>
        <p>
          Only to provide the bookkeeping and tax services you engaged us for: keeping your books, preparing financial
          statements and tax filings (including Forms 1099), answering your questions, securing the system, and meeting
          legal and record-keeping obligations.
        </p>

        <h2 className="font-semibold text-slate-900">How we share it</h2>
        <table className="w-full border text-left text-xs">
          <thead className="bg-slate-100"><tr><th className="p-2">Reason we share</th><th className="p-2">Do we share?</th><th className="p-2">Can you limit it?</th></tr></thead>
          <tbody>
            <tr className="border-t"><td className="p-2">Everyday business purposes — to provide your services, comply with law, respond to legal process</td><td className="p-2">Yes</td><td className="p-2">No</td></tr>
            <tr className="border-t"><td className="p-2">With service providers who process data for us under contract (below)</td><td className="p-2">Yes</td><td className="p-2">No</td></tr>
            <tr className="border-t"><td className="p-2">For our marketing, or joint marketing with other companies</td><td className="p-2">No</td><td className="p-2">We don&apos;t share</td></tr>
            <tr className="border-t"><td className="p-2">With affiliates or non-affiliates so they can market to you</td><td className="p-2">No</td><td className="p-2">We don&apos;t share</td></tr>
            <tr className="border-t"><td className="p-2">Selling your information</td><td className="p-2">No</td><td className="p-2">We don&apos;t sell</td></tr>
          </tbody>
        </table>
        <p>Service providers:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Plaid Inc.</strong> — connects your bank accounts. Plaid&apos;s handling of your data is described in the{' '}
            <a className="text-teal-700 underline" href="https://plaid.com/legal/#end-user-privacy-policy" target="_blank" rel="noreferrer">Plaid End User Privacy Policy</a>.</li>
          <li><strong>Our hosting provider</strong> (Render) — runs the application and database, encrypted at rest.</li>
          <li><strong>Our email provider</strong> — sends sign-in links and notices (no financial data in emails).</li>
          <li><strong>Anthropic</strong> (AI) — helps categorize transactions. It receives only masked transaction text (names, account and reference numbers removed), amounts and dates — never your name, email, account numbers or tax IDs — and does not use it to train its models under our commercial terms.</li>
        </ul>

        <h2 className="font-semibold text-slate-900">Tax return information</h2>
        <p>
          Information you give us to prepare your tax returns is protected by Internal Revenue Code §7216. We use and
          disclose it only to prepare your returns and provide the related bookkeeping, or as the law allows (for example
          to service providers who help us do that work). We will not use it for any other purpose, or disclose it to
          anyone else, without your separate written consent in the form the IRS requires.
        </p>

        <h2 className="font-semibold text-slate-900">How we protect it</h2>
        <p>
          We follow a written information security program under the FTC Safeguards Rule: encryption in transit and at
          rest (bank access tokens, tax IDs and two-step secrets are additionally encrypted), two-step verification,
          role-based access (clients see only their own business), automatic sign-out, an audit log of staff access to
          client data, vetted service providers, and an incident response plan.
        </p>

        <h2 className="font-semibold text-slate-900">How long we keep it</h2>
        <p>
          We keep books, tax records and supporting documents for at least seven years after the tax year they relate to
          (longer if the law or a pending matter requires), then delete them securely. Disconnecting a bank stops new data
          immediately and revokes our access at Plaid; history already imported stays with your books for the retention period.
        </p>

        <h2 className="font-semibold text-slate-900">Your choices and rights</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>You can disconnect a bank at any time from the Bank page.</li>
          <li>You can ask for a copy of your records, ask us to correct them, or ask us to delete what we are not required to keep — write to {f.email}.</li>
          <li>If we ever change how we share information, we will notify you first and, where required, give you the right to opt out.</li>
        </ul>

        <h2 className="font-semibold text-slate-900">If something goes wrong</h2>
        <p>
          If your personal information is involved in a security breach, we will notify you as required by law — under
          {` ${f.state}`} law generally within 30 days — and notify regulators where required (including the Federal Trade
          Commission for events involving 500 or more people).
        </p>

        <h2 className="font-semibold text-slate-900">Questions and changes</h2>
        <p>
          Contact {f.legalName} at {f.email}. If we change this notice we will post the new version here and ask you to
          review it the next time you sign in.
        </p>
        <p><a href="/login" className="text-teal-700 hover:underline">Back</a></p>
      </article>
    </div>
  );
}
