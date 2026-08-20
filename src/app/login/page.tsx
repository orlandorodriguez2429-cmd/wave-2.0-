import { redirect } from 'next/navigation';
import { readSession } from '@/lib/auth';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await readSession()) redirect('/');
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-blue-700">Wave 2.0</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to your books.</p>
        </div>
        <LoginForm />
        <p className="text-xs text-slate-400">
          Demo login: <code>demo@wave2.local</code> / <code>demo-password-123</code>
        </p>
      </div>
    </div>
  );
}
