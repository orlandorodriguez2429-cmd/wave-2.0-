import { getClientContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { isPlaidConfigured } from '@/lib/banking/plaid-client';
import { PlaidLinkButton } from '@/app/banking/plaid-link-button';
import { StatementUploadForm } from '@/app/banking/statement-upload-form';

export const dynamic = 'force-dynamic';

export default async function ClientBank() {
  const { business } = await getClientContext();
  const plaidOn = isPlaidConfigured();
  const connections = await prisma.bankConnection.findMany({
    where: { businessId: business.id, status: { not: 'REMOVED' } },
    include: { accounts: { select: { id: true, name: true, mask: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Bank</h1>

      {connections.map((c) => (
        <div key={c.id} className={`rounded-lg border bg-white px-5 py-4 ${c.status === 'ACTIVE' ? 'border-slate-200' : 'border-amber-300'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{c.institutionName}</p>
              <p className="text-sm text-slate-500">
                {c.accounts.map((a) => `${a.name}${a.mask ? ` ••${a.mask}` : ''}`).join(', ')}
                {c.provider !== 'upload' && <> · last update {c.lastSyncAt ? c.lastSyncAt.toISOString().slice(0, 10) : 'pending'}</>}
              </p>
            </div>
            {c.status === 'NEEDS_RECONNECT' && c.provider === 'plaid' && plaidOn ? (
              <PlaidLinkButton reconnectConnectionId={c.id} label="Reconnect" variant="secondary" audience="client" />
            ) : (
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                {c.provider === 'upload' ? 'statements' : c.status === 'ACTIVE' ? 'connected' : 'needs attention'}
              </span>
            )}
          </div>
        </div>
      ))}

      {plaidOn && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="font-medium">Connect your bank</h2>
          {/* PLACEHOLDER consent wording — to be reviewed by counsel (see /privacy). */}
          <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 space-y-2">
            <p><strong>Before you connect:</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>We use <strong>Plaid</strong> to connect to your bank. You sign in to your bank in Plaid&apos;s window — we never see or store your bank username or password.</li>
              <li>What we receive: your account names, the last 4 digits of each account number, and your transactions (date, description, amount). We do not receive full account numbers.</li>
              <li>Why: so {business.name}&apos;s books can be kept up to date each month without you sending statements.</li>
              <li>Who sees it: your bookkeepers at Your Tax Solution, and you in this portal.</li>
              <li>You can ask us to disconnect at any time; history already received stays in your books.</li>
            </ul>
            <p className="text-xs text-slate-400">By continuing you agree to share this information for that purpose. See our <a href="/privacy" className="underline">privacy policy</a>.</p>
          </div>
          <PlaidLinkButton label="I agree — connect my bank" audience="client" />
        </div>
      )}

      <StatementUploadForm
        audience="client"
        accounts={connections.flatMap((c) => c.accounts.map((a) => ({ value: a.id, label: `${c.institutionName} · ${a.name}${a.mask ? ` ••${a.mask}` : ''}` })))}
      />
    </div>
  );
}
