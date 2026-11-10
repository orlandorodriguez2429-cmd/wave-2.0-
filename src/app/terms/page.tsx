// PLACEHOLDER — not legal text. Have this reviewed and rewritten by a lawyer.
export const metadata = { title: 'Terms of use (draft) · Your Tax Solution Books' };

export default function TermsPage() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-slate-50">
      <article className="mx-auto max-w-2xl px-6 py-10 space-y-4 text-sm text-slate-700">
        <div className="rounded-md border-2 border-red-300 bg-red-50 p-4 text-red-800">
          <strong>DRAFT — NOT REVIEWED.</strong> Placeholder outline only, for the owner&apos;s attorney to replace. Not final terms.
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Terms of use</h1>
        <p className="text-slate-500">[Business legal name — to be completed]</p>
        <h2 className="font-semibold text-slate-900">Topics the final terms need to cover</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Who may use the portal (clients we invite, and our staff) and account security duties (keep your password and two-step device safe).</li>
          <li>The portal is read-only access to bookkeeping prepared by us; reports are not audited financial statements unless separately agreed.</li>
          <li>Connecting a bank: authorization to receive data through Plaid; Plaid&apos;s own end-user terms apply.</li>
          <li>How this relates to the engagement letter / service agreement for bookkeeping and tax services.</li>
          <li>Availability, changes, suspension and termination of access.</li>
          <li>Limitation of liability, governing law, and how to contact us.</li>
        </ul>
        <p><a href="/login" className="text-teal-700 hover:underline">Back to sign in</a></p>
      </article>
    </div>
  );
}
