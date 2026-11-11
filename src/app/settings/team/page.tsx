import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { addMemberAction, removeMemberAction, resetMemberMfaAction, revokeInviteAction } from '@/app/auth-actions';
import { revokeApiTokenAction } from '@/app/team-actions';
import { NewBusinessForm, TokenForm, InviteClientForm, DeleteBusinessForm } from './team-forms';
import { ChangePasswordForm } from '@/components/change-password-form';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { business, user, role } = await getCurrentContext();
  const [members, tokens, webhooks, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { businessId: business.id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.apiToken.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'desc' } }),
    prisma.webhookSubscription.findMany({ where: { businessId: business.id } }),
    prisma.invite.findMany({
      where: { businessId: business.id, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const canInvite = role === 'OWNER' || role === 'ACCOUNTANT';
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
                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                    {m.user.mfaEnabledAt ? '2-step on' : <span className="text-amber-700">2-step not set up</span>}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap space-x-2">
                    {isOwner && m.userId !== user.id && m.user.mfaEnabledAt && (
                      <ActionButton action={resetMemberMfaAction.bind(null, m.id)} label="Reset 2-step" confirmLabel="Reset (lost phone)" />
                    )}
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
          expenses only, cannot post to the ledger) · view only · client (portal only, invited below). Everyone signs
          in with two-step verification.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Your password</h2>
        <ChangePasswordForm />
      </section>

      {canInvite && (
        <section className="space-y-3">
          <h2 className="font-medium">Client portal</h2>
          <p className="text-sm text-slate-500">
            Invite the business owner to a read-only portal: dashboard, months, Profit &amp; Loss, transactions, and connecting
            their own bank. They only ever see {business.name}.
          </p>
          <InviteClientForm />
          {invites.length > 0 && (
            <ul className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-50 text-sm">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between px-5 py-2.5">
                  <span>{i.email} <span className="text-slate-400">· invited, expires {i.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</span></span>
                  <ActionButton action={revokeInviteAction.bind(null, i.id)} label="Cancel invite" />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

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
      {isOwner && (
        <section className="space-y-3">
          <h2 className="font-medium text-red-700">Delete this business</h2>
          <DeleteBusinessForm name={business.name} />
        </section>
      )}
    </div>
  );
}
