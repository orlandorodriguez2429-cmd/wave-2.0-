// PLACEHOLDER — not legal text. Have this reviewed and rewritten by a lawyer
// before any client uses the app. See SECURITY.md for the facts to describe.
export const metadata = { title: 'Privacy policy (draft) · Your Tax Solution Books' };

export default function PrivacyPage() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-slate-50">
      <article className="mx-auto max-w-2xl px-6 py-10 space-y-4 text-sm text-slate-700">
        <div className="rounded-md border-2 border-red-300 bg-red-50 p-4 text-red-800">
          <strong>DRAFT — NOT REVIEWED.</strong> This page is a placeholder outline for the owner to have reviewed and rewritten by
          counsel. It is not a final privacy policy and must not be relied on as one.
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Privacy policy</h1>
        <p className="text-slate-500">[Business legal name, address, contact email — to be completed]</p>
        <h2 className="font-semibold text-slate-900">Topics the final policy needs to cover</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Who we are and how to contact us about privacy.</li>
          <li>What we collect: login details (name, email); business bookkeeping data; bank account names, last 4 digits and transactions received through Plaid or uploaded statements; contractor W-9 details (TINs stored encrypted).</li>
          <li>What we do not collect: bank usernames or passwords (Plaid handles bank sign-in); full bank account numbers.</li>
          <li>Why we use it: to keep the business&apos;s books and prepare tax filings, including 1099s.</li>
          <li>Service providers who process data for us: Plaid (bank connections), our hosting provider, our email provider, and Anthropic (AI categorization of cleaned transaction descriptions — no names, account numbers or tax IDs are sent). Link to each provider&apos;s policy.</li>
          <li>How long we keep data, and how to ask for it to be deleted (deleting a business disconnects its banks at Plaid and deletes its data).</li>
          <li>Security measures (encryption, two-step sign-in, access controls) — see our written information security plan.</li>
          <li>Rights under applicable law (state privacy laws; GLBA / FTC Safeguards Rule obligations for tax preparers), and how we handle requests.</li>
          <li>Changes to this policy and the effective date.</li>
        </ul>
        <p><a href="/login" className="text-teal-700 hover:underline">Back to sign in</a></p>
      </article>
    </div>
  );
}
