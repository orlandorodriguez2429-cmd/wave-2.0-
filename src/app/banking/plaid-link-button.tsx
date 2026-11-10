'use client';

// Opens Plaid Link. Connect mode: exchanges the public_token on the server.
// Reconnect mode (update mode): Link repairs the login on an existing item,
// so there is no token to exchange; we just tell the server it's repaired.
// No access token ever reaches this component.
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { createLinkTokenAction, exchangePublicTokenAction, markReconnectedAction } from '@/app/banking-actions';

export function PlaidLinkButton({
  reconnectConnectionId,
  label,
  variant = 'primary',
}: {
  reconnectConnectionId?: string;
  label: string;
  variant?: 'primary' | 'secondary';
}) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const onSuccess = useCallback(
    (publicToken: string | null) => {
      setLinkToken(null);
      startTransition(async () => {
        const res = reconnectConnectionId
          ? await markReconnectedAction(reconnectConnectionId)
          : publicToken
            ? await exchangePublicTokenAction(publicToken)
            : { error: 'Plaid did not return a connection.' };
        if (res.error) setError(res.error);
        else setMessage(reconnectConnectionId ? 'Bank reconnected.' : 'Bank connected. Transactions are loading.');
        router.refresh();
      });
    },
    [reconnectConnectionId, router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      setLinkToken(null);
      // Only Plaid's display message, never metadata.
      if (err) setError(err.display_message || 'The bank connection was not completed.');
    },
  });

  // Open Link as soon as a fresh token is ready.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const start = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await createLinkTokenAction(reconnectConnectionId);
      if (res.error || !res.linkToken) setError(res.error ?? 'Could not start Plaid Link.');
      else setLinkToken(res.linkToken);
    });
  };

  const cls =
    variant === 'primary'
      ? 'bg-teal-600 text-white hover:bg-teal-700'
      : 'border border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100';

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={start}
        disabled={busy || !!linkToken}
        className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${cls}`}
      >
        {busy || linkToken ? '…' : label}
      </button>
      {message && <span className="text-sm text-green-700">{message}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}
