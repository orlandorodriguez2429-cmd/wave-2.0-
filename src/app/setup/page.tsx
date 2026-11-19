import { notFound } from 'next/navigation';
import { setupAvailable } from '@/lib/setup';
import { SetupForm } from './setup-form';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  if (!(await setupAvailable())) notFound();
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100 overflow-y-auto py-8">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <BrandMark />
        <h1 className="text-xl font-semibold text-[var(--brand-navy)]">Set up Your Tax Solution Books</h1>
          <p className="text-sm text-slate-500 mt-1">
            Create the owner account. This page works once. The setup code is <code>SETUP_CODE</code> in your host&apos;s
            environment settings.
          </p>
        </div>
        <SetupForm />
      </div>
    </div>
  );
}
