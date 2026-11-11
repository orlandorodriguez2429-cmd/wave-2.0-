export default function PaymentsSetupPage() {
  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold">Payments Setup</h1>
        <p className="text-sm text-slate-500 mt-1">
          How your customers pay you online — invoice portal payments and Checkouts.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Card processor</span>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Sandbox
          </span>
        </div>
        <p className="text-sm text-slate-500">
          No live payment processor is connected. Invoice portal payments and Checkouts currently record
          a simulated card payment straight to the books — enough to test the full accounting flow, but
          it doesn&apos;t move real money. Connecting Stripe Connect (or another processor) needs your
          own merchant account; this project doesn&apos;t and can&apos;t create one for you.
        </p>
        <p className="text-sm text-slate-500">
          Once you have a Stripe account, tell your developer to swap the sandbox pay step in{' '}
          <code className="font-mono text-xs">portalPayAction</code> and{' '}
          <code className="font-mono text-xs">payCheckout</code> for a real Stripe Checkout session —
          the ledger posting on the other side doesn&apos;t change.
        </p>
      </div>
    </div>
  );
}
