import { redirect } from 'next/navigation';
import { getCurrentContext } from '@/lib/context';
import { buildAliasMap } from '@/lib/assistant/aliases';
import { loadConversation, toView } from '@/lib/assistant/run';
import { Chat } from './chat';

export const dynamic = 'force-dynamic';

export default async function AssistantPage() {
  const { user, role } = await getCurrentContext();
  if (role !== 'OWNER' && role !== 'ACCOUNTANT') redirect('/');
  const conv = await loadConversation(user.id);
  const initial = conv ? toView(conv, await buildAliasMap(user.id)) : null;
  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Assistant</h1>
        <p className="text-sm text-slate-500 mt-1">
          Ask in plain English across all your clients. It looks things up in the books and can propose changes — categorize,
          add a rule, exclude, close a month — that only happen when you click Approve.
        </p>
      </div>
      <Chat initial={initial} enabled={!!process.env.ANTHROPIC_API_KEY} />
    </div>
  );
}
