import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth';
import { setupAvailable } from '@/lib/setup';
import { LoginForm } from './login-form';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await readSession();
  if (session) redirect(session.role === 'CLIENT' ? '/client' : '/');
  if (await setupAvailable()) redirect('/setup');
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <BrandMark />
        <h1 className="text-xl font-semibold text-[var(--brand-navy)]">Sign in to your books</h1>
          <p className="text-sm text-slate-500 mt-1">Monthly books, Profit &amp; Loss and 1099s.</p>
        </div>
        <LoginForm />
        <p className="text-xs text-slate-400">
          Two-step verification is required for every account. <a href="/login/forgot" className="text-teal-700 hover:underline">Forgot password?</a>
        </p>
        <p className="text-xs text-slate-400">
          <a href="/privacy" className="hover:underline">Privacy</a> · <a href="/terms" className="hover:underline">Terms</a>
        </p>
      </div>
    </div>
  );
}
