'use client';

// Where a bank's own sign-in page (OAuth) sends the user back. Re-opens Plaid
// Link with the saved link token to finish, then returns to where they started.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { ACTIONS } from './plaid-link-button';
import { takeLinkSession, type SavedLinkSession } from './plaid-oauth-store';

export function PlaidOAuthResume({ audience }: { audience: 'staff' | 'client' }) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedLinkSession | null | undefined>(undefined);
  const [status, setStatus] = useState('Finishing the bank connection…');
  const [href, setHref] = useState<string | undefined>(undefined);

  useEffect(() => {
    const s = takeLinkSession();
    setSaved(s && s.audience === audience ? s : null);
    setHref(window.location.href);
  }, [audience]);

  const home = audience === 'client' ? '/client/bank' : '/banking';
  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      if (!saved) return;
      const actions = ACTIONS[saved.audience];
      const res = saved.reconnectConnectionId
        ? await actions.reconnected(saved.reconnectConnectionId)
        : publicToken
          ? await actions.exchange(publicToken)
          : { error: 'Plaid did not return a connection.' };
      if (res.error) setStatus(res.error);
      else router.replace(saved.returnTo || home);
    },
    [saved, router, home],
  );

  const { open, ready } = usePlaidLink({
    token: saved?.linkToken ?? null,
    receivedRedirectUri: href,
    onSuccess,
    onExit: (err) => setStatus(err?.display_message || 'The bank connection was not completed.'),
  });

  useEffect(() => {
    if (saved && href && ready) open();
  }, [saved, href, ready, open]);

  if (saved === null) {
    return (
      <p className="text-sm text-slate-600">
        This bank sign-in has expired. <a className="text-teal-700 underline" href={home}>Start the connection again</a>.
      </p>
    );
  }
  return (
    <p className="text-sm text-slate-600">
      {status} <a className="text-teal-700 underline" href={home}>Back to bank accounts</a>
    </p>
  );
}
