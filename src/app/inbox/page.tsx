import { redirect } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { DropZone } from './drop-zone';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const { role } = await getCurrentContext();
  if (role !== 'OWNER' && role !== 'ACCOUNTANT') redirect('/');
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Statement inbox</h1>
        <p className="text-sm text-slate-500 mt-1">
          Drop statements for any clients and any months. Each one is read here (no AI), filed under the right client and
          account — by bank and last 4 digits, or by the business name on it, or as a new client — imported only if the
          balances add up, sorted automatically, and every month that&apos;s complete and fully sorted is closed. Only what&apos;s
          unclear is left for you.
        </p>
      </div>
      <DropZone />
    </div>
  );
}
