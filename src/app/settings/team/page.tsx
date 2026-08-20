import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { addMemberAction, removeMemberAction } from '@/app/auth-actions';
import { revokeApiTokenAction } from '@/app/team-actions';
import { NewBusinessForm, TokenForm } from './team-forms';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { business, user, role } = await getCurrentContext();
  const [members, tokens, webhooks] = await Promise.all([
    prisma.membership.findMany({
      where: { businessId: business.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.apiToken.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'desc' } }),
    prisma.webhookSubscription.findMany({ where: { businessId: business.id } }),
  ]);
  const isOwner = role === 'OWNER';

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Team &amp; Developer Settings</h1>
        <p className="text-sm text-slate-500 mt-1">{business.name}</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-medium">Members</h2>
        <div className="rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5">{m.user.name}</td>
                  <td className="px-3 py-2.5 text-slate-500">{m.user.email}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium">
                      {m.role.toLowerCase().replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    {isOwner && m.userId !== user.id && (
                      <ActionButton action={removeMemberAction.bind(null, m.id)} label="Remove" confirmLabel="Confirm" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isOwner && (
          <SimpleRecordForm
            action={addMemberAction}
            submitLabel="Add member"
            fields={[
              { name: 'email', label: 'Email', required: true, width: 'w-56' },
              { name: 'name', label: 'Name', width: 'w-40' },
              {
                name: 'role',
                label: 'Role',
                type: 'select',
                options: [
                  { value: 'ACCOUNTANT', label: 'accountant' },
                  { value: 'EMPLOYEE', label: 'employee' },
                  { value: 'CONTRACTOR_VIEW', label: 'view only' },
                  { value: 'OWNER', label: 'owner' },
                ],
              },
              { name: 'tempPassword', label: 'Temp password (new users)', width: 'w-44' },
            ]}
          />
        )}
        <p className="text-xs text-slate-400">
          Roles: owner (everything) · accountant (all bookkeeping incl. 1099 filing) · employee (drafts and
          expenses only, cannot post to the ledger) · view only.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Another business?</h2>
        <NewBusinessForm />
        <p className="text-xs text-slate-400">
          Each business has its own chart of accounts, ledger, and settings; switch between them in the
          sidebar.
        </p>
      </section>

      {isOwner && (
        <section className="space-y-3">
          <h2 className="font-medium">API tokens</h2>
          <TokenForm />
          <div className="rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className={`border-b border-slate-50 last:border-0 ${t.revokedAt ? 'opacity-40' : ''}`}>
                    <td className="px-5 py-2.5">{t.name}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">
                      created {t.createdAt.toISOString().slice(0, 10)}
                      {t.lastUsedAt && ` · last used ${t.lastUsedAt.toISOString().slice(0, 10)}`}
                      {t.revokedAt && ' · revoked'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {!t.revokedAt && (
                        <ActionButton action={revokeApiTokenAction.bind(null, t.id)} label="Revoke" confirmLabel="Confirm" />
                      )}
                    </td>
                  </tr>
                ))}
                {tokens.length === 0 && (
                  <tr><td className="px-5 py-4 text-slate-400">No tokens yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            REST API: <code>GET /api/v1/accounts</code>, <code>GET /api/v1/invoices</code>,{' '}
            <code>GET /api/v1/reports/trial-balance</code>, <code>GET|POST /api/v1/webhooks</code> with{' '}
            <code>Authorization: Bearer &lt;token&gt;</code>. Webhook deliveries are HMAC-signed
            (X-Wave-Signature). {webhooks.length} webhook subscription(s) active.
          </p>
        </section>
      )}
    </div>
  );
}
