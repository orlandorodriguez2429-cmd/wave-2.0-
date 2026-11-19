import Link from 'next/link';
import { getCurrentContext } from '@/lib/context';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function PayrollDashboardPage() {
  const { business } = await getCurrentContext();
  const [activeCount, hoursThisMonth] = await Promise.all([
    prisma.employee.count({ where: { businessId: business.id, status: 'ACTIVE' } }),
    prisma.timesheet.aggregate({
      where: {
        businessId: business.id,
        weekStart: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
      _sum: { hours: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Payroll Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Real W-2 payroll — tax withholding, direct deposit, quarterly/annual filings — needs a licensed
          payroll-tax provider this project doesn&apos;t have. What&apos;s built: an employee directory and
          timesheets, so the data is ready to hand to a provider later. 1099 contractor payments are fully
          supported under Tax filing.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Active employees</div>
          <div className="text-2xl font-semibold mt-1">{activeCount}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Hours logged this month</div>
          <div className="text-2xl font-semibold mt-1">{Number(hoursThisMonth._sum.hours ?? 0).toFixed(1)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link href="/payroll/employees" className="rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm transition">
          <h2 className="text-base font-semibold text-slate-900">Employees</h2>
          <p className="text-sm text-slate-500 mt-1">Directory of who works for you, and their pay basis.</p>
        </Link>
        <Link href="/payroll/timesheets" className="rounded-lg border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm transition">
          <h2 className="text-base font-semibold text-slate-900">Payroll Timesheets</h2>
          <p className="text-sm text-slate-500 mt-1">Log hours worked per employee, per week.</p>
        </Link>
        <Link href="/payroll/transactions" className="rounded-lg border border-dashed border-slate-300 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Payroll Transactions</h2>
          <p className="text-sm text-slate-500 mt-1">Not yet available — needs a payroll run engine.</p>
        </Link>
        <Link href="/payroll/taxes" className="rounded-lg border border-dashed border-slate-300 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-900">Taxes</h2>
          <p className="text-sm text-slate-500 mt-1">Not yet available — needs a payroll-tax provider.</p>
        </Link>
      </div>
    </div>
  );
}
