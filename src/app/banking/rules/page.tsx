import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { createRuleAction, deleteRuleAction } from '@/app/banking-actions';

export const dynamic = 'force-dynamic';

export default async function RulesPage() {
  const { business } = await getCurrentContext();
  const [rules, accounts] = await Promise.all([
    prisma.categorizationRule.findMany({ where: { businessId: business.id }, orderBy: { priority: 'asc' } }),
    prisma.account.findMany({ where: { businessId: business.id, isArchived: false }, orderBy: { code: 'asc' } }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.id, `${a.code} · ${a.name}`]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Categorization Rules</h1>
        <p className="text-sm text-slate-500 mt-1">
          Applied to newly imported bank transactions in priority order; lowest number wins. Suggestions
          still require your confirmation before anything posts.
        </p>
      </div>
      <SimpleRecordForm
        action={createRuleAction}
        submitLabel="Add rule"
        fields={[
          { name: 'pattern', label: 'Pattern', placeholder: 'AWS', required: true, width: 'w-44' },
          {
            name: 'matchType',
            label: 'Match',
            type: 'select',
            options: [
              { value: 'CONTAINS', label: 'contains' },
              { value: 'REGEX', label: 'regex' },
            ],
          },
          {
            name: 'appliesTo',
            label: 'Applies to',
            type: 'select',
            options: [
              { value: 'BOTH', label: 'both' },
              { value: 'OUTFLOW', label: 'money out' },
              { value: 'INFLOW', label: 'money in' },
            ],
          },
          {
            name: 'accountId',
            label: 'Category account',
            type: 'select',
            options: accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
          },
          { name: 'priority', label: 'Priority', placeholder: '100', width: 'w-20' },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Priority</th>
              <th className="px-3 py-3 font-medium">Pattern</th>
              <th className="px-3 py-3 font-medium">Type</th>
              <th className="px-3 py-3 font-medium">Direction</th>
              <th className="px-3 py-3 font-medium">Category</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-2.5 tabular-nums">{r.priority}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{r.pattern}</td>
                <td className="px-3 py-2.5 text-slate-500">{r.matchType.toLowerCase()}</td>
                <td className="px-3 py-2.5 text-slate-500">{r.appliesTo.toLowerCase()}</td>
                <td className="px-3 py-2.5">{accountName.get(r.accountId) ?? '—'}</td>
                <td className="px-5 py-2.5 text-right">
                  <ActionButton action={deleteRuleAction.bind(null, r.id)} label="Delete" confirmLabel="Confirm" variant="secondary" />
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>No rules yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
