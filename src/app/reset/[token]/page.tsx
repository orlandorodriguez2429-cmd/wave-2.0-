import { checkResetToken } from '@/lib/password-reset';
import { ResetForm } from './reset-form';
import { BrandMark } from '@/components/brand-mark';

export const dynamic = 'force-dynamic';

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await checkResetToken(token);
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <BrandMark />
        <h1 className="text-xl font-semibold text-[var(--brand-navy)]">Choose a new password</h1>
        {valid ? (
          <ResetForm token={token} />
        ) : (
          <p className="text-sm text-slate-600">
            This reset link is not valid any more (links work once, for 60 minutes). <a href="/login/forgot" className="text-teal-700 hover:underline">Ask for a new one</a>.
          </p>
        )}
      </div>
    </div>
  );
}
