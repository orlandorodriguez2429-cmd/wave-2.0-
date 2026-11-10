import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const session = await readSession();
  if (session) redirect(session.role === 'CLIENT' ? '/client' : '/');
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-teal-700">Your Tax Solution Books</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to your books.</p>
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
