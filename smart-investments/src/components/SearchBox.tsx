"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SearchBox({ placeholder, button, initial = "" }: { placeholder: string; button: string; initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [pending, start] = useTransition();

  return (
    <form
      className="no-print flex w-full flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (!q.trim()) return;
        start(() => router.push(`/search?q=${encodeURIComponent(q.trim())}`));
      }}
    >
      <input
        className="input !rounded-full !px-5 !py-3.5 !text-base"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
      />
      <button className="btn !px-7 !py-3.5 !text-base" disabled={pending}>
        {pending ? <span className="spinner !h-5 !w-5 !border-2" /> : button}
      </button>
    </form>
  );
}
