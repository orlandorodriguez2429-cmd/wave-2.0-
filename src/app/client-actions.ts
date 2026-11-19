'use server';

// The only things a CLIENT can change: connect/reconnect their own bank and
// upload a statement. Everything is scoped to the business on their
// membership (getClientContext); ids from the browser are re-checked against it.
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getClientContext } from '@/lib/context';
import { decryptSecret } from '@/lib/crypto';
import { connectPlaidItem, markReconnected, syncConnection } from '@/lib/banking/import';
import { createLinkToken } from '@/lib/banking/plaid';
import { isPlaidConfigured } from '@/lib/banking/plaid-client';
import { importStatement } from '@/lib/banking/statement';
import type { ActionResult } from './actions';

const msg = (err: unknown) => ({ error: err instanceof Error ? err.message : 'Something went wrong.' });

export async function clientCreateLinkTokenAction(reconnectConnectionId?: string): Promise<{ linkToken?: string; error?: string }> {
  const { user, business } = await getClientContext();
  if (!isPlaidConfigured()) return { error: 'Bank connections are not available yet. Upload a statement instead.' };
  try {
    let accessToken: string | undefined;
    if (reconnectConnectionId) {
      const c = await prisma.bankConnection.findUnique({ where: { id: reconnectConnectionId } });
      if (!c || c.businessId !== business.id || c.provider !== 'plaid' || !c.accessTokenEncrypted || c.status === 'REMOVED') {
        return { error: 'Connection not found.' };
      }
      accessToken = decryptSecret(c.accessTokenEncrypted);
    }
    return { linkToken: await createLinkToken({ clientUserId: user.id, accessToken }) };
  } catch (err) {
    return msg(err);
  }
}

export async function clientExchangePublicTokenAction(publicToken: string): Promise<ActionResult> {
  const { user, business } = await getClientContext();
  if (!isPlaidConfigured()) return { error: 'Bank connections are not available yet.' };
  if (typeof publicToken !== 'string' || !publicToken.startsWith('public-')) return { error: 'Invalid response from the bank window.' };
  try {
    const { id } = await connectPlaidItem({ businessId: business.id, userId: user.id, publicToken });
    await syncConnection({ businessId: business.id, userId: user.id, connectionId: id, trigger: 'connect' }).catch(() => undefined);
    revalidatePath('/client/bank');
    return {};
  } catch (err) {
    return msg(err);
  }
}

export async function clientMarkReconnectedAction(connectionId: string): Promise<ActionResult> {
  const { user, business } = await getClientContext();
  try {
    await markReconnected({ businessId: business.id, userId: user.id, connectionId });
    await syncConnection({ businessId: business.id, userId: user.id, connectionId, trigger: 'manual' }).catch(() => undefined);
    revalidatePath('/client/bank');
    return {};
  } catch (err) {
    return msg(err);
  }
}

export async function clientUploadStatementAction(
  _prev: ActionResult & { message?: string },
  formData: FormData,
): Promise<ActionResult & { message?: string }> {
  const { user, business } = await getClientContext();
  try {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) return { error: 'Choose the statement CSV file.' };
    if (file.size > 2 * 1024 * 1024) return { error: 'That file is larger than 2 MB.' };
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!isPdf && !/\.csv$/i.test(file.name)) return { error: 'Please upload your statement as a PDF or CSV file.' };
    const target = String(formData.get('linkId') ?? '');
    const r = await importStatement({
      businessId: business.id, // linkId is re-checked against this business inside
      userId: user.id,
      fileName: file.name,
      ...(isPdf ? { pdf: new Uint8Array(await file.arrayBuffer()) } : { csvText: await file.text() }),
      openingBalance: String(formData.get('opening') ?? ''),
      closingBalance: String(formData.get('closing') ?? ''),
      positiveIsMoneyOut: formData.get('positiveIsMoneyOut') === 'on',
      ...(target && target !== 'new'
        ? { linkId: target }
        : { newAccount: { name: String(formData.get('newName') ?? ''), kind: formData.get('newKind') === 'credit' ? ('credit' as const) : ('depository' as const) } }),
    });
    revalidatePath('/client/bank');
    return { message: `Thanks — ${r.imported} transaction(s) received${r.duplicates ? ` (${r.duplicates} were already on file)` : ''}.` };
  } catch (err) {
    return msg(err);
  }
}
