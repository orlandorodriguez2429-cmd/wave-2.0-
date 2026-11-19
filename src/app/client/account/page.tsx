import { getClientContext } from '@/lib/context';
import { ChangePasswordForm } from '@/components/change-password-form';

export const dynamic = 'force-dynamic';

export default async function ClientAccount() {
  const { user } = await getClientContext();
  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-semibold">Your account</h1>
      <p className="text-sm text-slate-500">Signed in as {user.email}. Two-step verification is on.</p>
      <ChangePasswordForm />
    </div>
  );
}
