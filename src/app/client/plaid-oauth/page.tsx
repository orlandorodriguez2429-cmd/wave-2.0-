import { getClientContext } from '@/lib/context';
import { PlaidOAuthResume } from '../../banking/plaid-oauth-resume';

export const dynamic = 'force-dynamic';

export default async function ClientPlaidOAuthPage() {
  await getClientContext();
  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-xl font-semibold">Connecting your bank</h1>
      <PlaidOAuthResume audience="client" />
    </div>
  );
}
