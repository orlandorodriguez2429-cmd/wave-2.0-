'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/context';
import { processInbox, type InboxResult } from '@/lib/inbox';

const MAX_FILES = 40;

export async function dropStatementsAction(_prev: { results?: InboxResult[]; error?: string }, formData: FormData): Promise<{ results?: InboxResult[]; error?: string }> {
  const { user } = await requireContext('ACCOUNTANT');
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'Choose or drop at least one statement.' };
  if (files.length > MAX_FILES) return { error: `Drop up to ${MAX_FILES} statements at a time.` };
  const results = await processInbox({
    userId: user.id,
    files: await Promise.all(files.map(async (f) => ({ fileName: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
  });
  revalidatePath('/');
  revalidatePath('/firm');
  revalidatePath('/close');
  revalidatePath('/banking');
  return { results };
}
