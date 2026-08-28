import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { SimpleRecordForm } from '@/components/simple-record-form';
import { logTimesheetAction } from '@/app/payroll-actions';

export const dynamic = 'force-dynamic';

export default async function TimesheetsPage() {
  const { business } = await getCurrentContext();
  const [employees, timesheets] = await Promise.all([
    prisma.employee.findMany({ where: { businessId: business.id, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
    prisma.timesheet.findMany({
      where: { businessId: business.id },
      include: { employee: true },
      orderBy: { weekStart: 'desc' },
      take: 100,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payroll Timesheets</h1>
        <p className="text-sm text-slate-500 mt-1">Hours worked per employee, per week.</p>
      </div>
      {employees.length === 0 ? (
        <p className="text-sm text-slate-400">Add an employee first.</p>
      ) : (
        <SimpleRecordForm
          action={logTimesheetAction}
          submitLabel="Log hours"
          fields={[
            {
              name: 'employeeId',
              label: 'Employee',
              type: 'select',
              width: 'w-56',
              options: employees.map((e) => ({ value: e.id, label: e.name })),
            },
            { name: 'weekStart', label: 'Week of', type: 'date', required: true, width: 'w-40' },
            { name: 'hours', label: 'Hours', placeholder: '40', required: true, width: 'w-24' },
            { name: 'notes', label: 'Notes', width: 'flex-1 min-w-40' },
          ]}
        />
      )}
      <div className="rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-3 py-3 font-medium">Week of</th>
              <th className="px-3 py-3 font-medium text-right">Hours</th>
              <th className="px-5 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {timesheets.map((t) => (
              <tr key={t.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-medium">{t.employee.name}</td>
                <td className="px-3 py-3 text-slate-500">{t.weekStart.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-3 text-right tabular-nums">{Number(t.hours).toFixed(1)}</td>
                <td className="px-5 py-3 text-slate-500">{t.notes ?? ''}</td>
              </tr>
            ))}
            {timesheets.length === 0 && (
              <tr>
                <td className="px-5 py-6 text-slate-400" colSpan={4}>
                  No timesheets logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
