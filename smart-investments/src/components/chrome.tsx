"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { t, type Lang } from "@/lib/i18n";

export function Nav({ lang }: { lang: Lang }) {
  const path = usePathname();
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === "light" || saved === "dark") setTheme(saved);
    else setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
    setTheme(next);
  }

  function toggleLang() {
    const next = lang === "en" ? "es" : "en";
    document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const links = [
    { href: "/", label: t(lang, "nav.analyzer"), active: path === "/" || path.startsWith("/property") || path.startsWith("/search") },
    { href: "/leads", label: t(lang, "nav.leads"), active: path.startsWith("/leads") },
    { href: "/pipeline", label: lang === "es" ? "Seguimiento" : "Pipeline", active: path.startsWith("/pipeline") },
    { href: "/data", label: t(lang, "nav.data"), active: path.startsWith("/data") },
  ];

  return (
    <header className="no-print sticky top-0 z-40 px-4 pt-3">
      <nav
        className="mx-auto flex max-w-6xl items-center gap-2 rounded-full border px-3 py-2"
        style={{ background: "var(--card)", borderColor: "var(--border)", backdropFilter: "blur(18px)", boxShadow: "var(--shadow)" }}
      >
        <Link href="/" className="mr-1 flex items-center gap-2 pl-2 font-bold tracking-tight">
          <span
            className="inline-block h-6 w-6 rounded-lg"
            style={{ background: "linear-gradient(135deg, var(--accent), #6366f1)" }}
            aria-hidden
          />
          <span className="hidden sm:inline">Smart Investments Today</span>
        </Link>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-1.5 text-sm font-semibold transition-colors"
              style={l.active ? { background: "var(--accent-soft)", color: "var(--accent-strong)" } : { color: "var(--muted)" }}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <button onClick={toggleLang} className="btn btn-ghost !px-3 !py-1.5 text-xs" aria-label="Switch language">
          {lang === "en" ? "ES" : "EN"}
        </button>
        <button onClick={toggleTheme} className="btn btn-ghost !px-3 !py-1.5 text-xs" aria-label="Switch light or dark mode">
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </nav>
    </header>
  );
}

export function PrintButton({ label }: { label: string }) {
  return (
    <button className="btn no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
