'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { decideAssistantActionAction, sendAssistantMessageAction } from '@/app/assistant-actions';
import type { ChatView } from '@/lib/assistant/run';

const EXAMPLES = [
  'Which clients need attention this week?',
  'What is still waiting for review for each client?',
  "Show me last month's P&L for my biggest client",
  'Which contractors need a 1099 and are missing a W-9?',
];

export function Chat({ initial, enabled }: { initial: ChatView | null; enabled: boolean }) {
  const [view, setView] = useState<ChatView | null>(initial);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [view, pending]);

  const send = (q: string, fresh = false) => {
    if (!q.trim()) return;
    setError(null);
    setText('');
    start(async () => {
      const r = await sendAssistantMessageAction(fresh ? null : (view?.conversationId ?? null), q, fresh);
      if (r.error) setError(r.error);
      if (r.view) setView(r.view);
    });
  };
  const decide = (actionId: string, approve: boolean) =>
    start(async () => {
      if (!view) return;
      const r = await decideAssistantActionAction(view.conversationId, actionId, approve);
      if (r.error) setError(r.error);
      if (r.view) setView(r.view);
    });

  if (!enabled) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        The assistant needs an Anthropic API key. Add <code>ANTHROPIC_API_KEY</code> to the server&apos;s environment settings
        (on Render: web service → Environment) and restart. The same key also turns on AI sorting for transactions your rules
        don&apos;t catch.
      </div>
    );
  }

  const proposals = view?.actions ?? [];
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 min-h-80 max-h-[60vh] overflow-y-auto space-y-3">
        {(!view || view.messages.length === 0) && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Ask about your clients&apos; books. Try:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => send(e)} className="rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50">
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {view?.messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
              {m.text}
            </div>
          </div>
        ))}
        {pending && <p className="text-sm text-slate-400">Looking at the books…</p>}
        <div ref={bottom} />
      </div>

      {proposals.filter((a) => a.status === 'proposed').length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 space-y-2">
          <p className="text-sm font-medium text-violet-900">Waiting for your OK — nothing has changed yet</p>
          {proposals
            .filter((a) => a.status === 'proposed')
            .map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm">
                <span>{a.summary}</span>
                <span className="flex gap-2">
                  <button disabled={pending} onClick={() => decide(a.id, true)} className="rounded-md bg-teal-600 px-3 py-1 font-medium text-white disabled:opacity-50">
                    Approve
                  </button>
                  <button disabled={pending} onClick={() => decide(a.id, false)} className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-50">
                    Dismiss
                  </button>
                </span>
              </div>
            ))}
        </div>
      )}
      {proposals.filter((a) => a.status !== 'proposed').length > 0 && (
        <ul className="text-xs text-slate-500 space-y-1">
          {proposals
            .filter((a) => a.status !== 'proposed')
            .slice(-5)
            .map((a) => (
              <li key={a.id}>
                {a.status === 'approved' ? '✅' : a.status === 'failed' ? '⚠️' : '✖'} {a.summary}
                {a.result ? ` — ${a.result}` : ''}
              </li>
            ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          placeholder="Ask anything about your clients' books…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button disabled={pending || !text.trim()} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Send
        </button>
        {view && (
          <button type="button" disabled={pending} onClick={() => setView(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            New chat
          </button>
        )}
      </form>
      <p className="text-xs text-slate-400">
        Privacy: clients are sent to the AI as &quot;Client A&quot;, &quot;Client B&quot;…, contractors as &quot;Contractor 1&quot;…, and person names
        and account numbers in transactions are masked. Real names are only shown here, on your screen.
      </p>
    </div>
  );
}
