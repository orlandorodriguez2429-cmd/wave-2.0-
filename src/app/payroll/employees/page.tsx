import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { formatMoney } from '@/lib/money';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { ActionButton } from '@/components/action-button';
import { createEmployeeAction, archiveEmployeeAction } from '@/app/payroll-actions';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  const { business } = await getCurrentContext();
  const employees = await prisma.employee.findMany({
    where: { businessId: business.id, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Employees</h1>
        <p className="text-sm text-slate-500 mt-1">
          A directory only — no wage or tax calculations happen here. See Payroll Dashboard for what
          real W-2 payroll would still need.
        </p>
      </div>
      <SimpleRecordForm
        action={createEmployeeAction}
        submitLabel="Add employee"
        fields={[
          { name: 'name', label: 'Name', required: true, width: 'flex-1 min-w-40' },
          { name: 'title', label: 'Title', width: 'w-40' },
          { name: 'email', label: 'Email', width: 'w-56' },
          {
            name: 'payType',
            label: 'Pay type',
            type: 'select',
            width: 'w-32',
            options: [
              { value: 'hourly', label: 'Hourly' },
              { value: 'salary', label: 'Salary' },
            ],
          },
          { name: 'rate', label: 'Rate', placeholder: '0.00', width: 'w-28' },
        ]}
      />
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Title</th>
              <th className="px-3 py-3 font-medium">Email</th>
              <th className="px-3 py-3 font-medium">Pay type</th>
              <th className="px-3 py-3 font-medium text-right">Rate</th>
              <th className="px-5 py-3 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                <td className="px-5 py-3 font-medium">{e.name}</td>
                <td className="px-3 py-3 text-slate-500">{e.title ?? '—'}</td>
                <td className="px-3 py-3 text-slate-500">{e.email ?? '—'}</td>
                <td className="px-3 py-3 text-slate-500 capitalize">{e.payType}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMoney(e.rate, business.functionalCurrency)}
                  {e.payType === 'hourly' ? '/hr' : '/yr'}
                </td>
                <td className="px-5 py-3 text-right">
                  <ActionButton action={archiveEmployeeAction.bind(null, e.id)} label="Archive" />
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={6}>
                  No employees yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
