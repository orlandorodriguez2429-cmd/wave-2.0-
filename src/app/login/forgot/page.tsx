import { ForgotForm } from './forgot-form';

export default function ForgotPage() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-teal-700">Reset your password</h1>
          <p className="text-sm text-slate-500 mt-1">We&apos;ll email you a link. You&apos;ll still need your two-step code to sign in.</p>
        </div>
        <ForgotForm />
        <a href="/login" className="block text-xs text-slate-500 hover:underline">Back to sign in</a>
      </div>
    </div>
  );
}
