'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/context';
import { hit } from '@/lib/rate-limit';
import { chatTurn, decideAction, type ChatView } from '@/lib/assistant/run';

export async function sendAssistantMessageAction(conversationId: string | null, text: string, fresh = false): Promise<{ view?: ChatView; error?: string }> {
  const { user } = await requireContext('ACCOUNTANT');
  if (!text.trim()) return { error: 'Type a question.' };
  if (!(await hit(`assistant:user:${user.id}`, { max: 60, windowSeconds: 3600 }))) return { error: 'That’s a lot of questions — try again in a bit.' };
  try {
    return { view: await chatTurn({ userId: user.id, conversationId: conversationId ?? undefined, text, fresh }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The assistant is unavailable right now.' };
  }
}

export async function decideAssistantActionAction(conversationId: string, actionId: string, approve: boolean): Promise<{ view?: ChatView; error?: string }> {
  const { user } = await requireContext('ACCOUNTANT');
  try {
    const view = await decideAction({ userId: user.id, conversationId, actionId, approve });
    revalidatePath('/banking');
    revalidatePath('/close');
    return { view };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not do that.' };
  }
}
