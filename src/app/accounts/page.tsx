import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { trialBalance } from '@/lib/ledger/reports';
import { signedBalance } from '@/lib/ledger/validate';
import { formatMoney } from '@/lib/money';
import type { AccountType } from '@/generated/prisma/enums';
import { NewAccountForm } from './new-account-form';
import { ArchiveToggle } from './archive-toggle';

export const dynamic = 'force-dynamic';

const TYPE_ORDER: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

export default async function AccountsPage() {
  const { business } = await getCurrentContext();
  const currency = business.functionalCurrency;

  const [accounts, tb] = await Promise.all([
    prisma.account.findMany({
      where: { businessId: business.id },
      orderBy: { code: 'asc' },
    }),
    trialBalance(business.id),
  ]);
  const balances = new Map(tb.rows.map((r) => [r.accountId, signedBalance(r.type, r.debits, r.credits)]));

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
          <p className="text-sm text-slate-500 mt-1">
            Balances shown in {currency}, following each account&apos;s normal balance.
          </p>
        </div>
      </div>

      <NewAccountForm />

      {TYPE_ORDER.map((type) => {
        const group = accounts.filter((a) => a.type === type);
        if (group.length === 0) return null;
        return (
          <div key={type} className="rounded-lg border border-slate-200 bg-white">
            <h2 className="px-5 py-3 border-b border-slate-100 font-medium">{TYPE_LABELS[type]}</h2>
            <table className="w-full text-sm">
              <tbody>
                {group.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-b border-slate-50 last:border-0 ${a.isArchived ? 'opacity-40' : ''}`}
                  >
                    <td className="px-5 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap">{a.code}</td>
                    <td className="px-3 py-2.5 w-full">
                      {a.name}
                      {a.subtype === 'cogs' && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">COGS</span>
                      )}
                      {a.isSystem && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">system</span>
                      )}
                      {a.isArchived && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">archived</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                      {formatMoney(balances.get(a.id) ?? 0n, currency)}
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      {!a.isSystem && <ArchiveToggle accountId={a.id} archived={a.isArchived} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
