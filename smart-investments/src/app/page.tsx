import Link from "next/link";
import { cookies } from "next/headers";
import { SearchBox } from "@/components/SearchBox";
import { parseLang, t } from "@/lib/i18n";

export default async function Home() {
  const lang = parseLang((await cookies()).get("lang")?.value);
  return (
    <div className="stagger flex flex-col gap-6">
      <section className="card !p-8 sm:!p-12">
        <div className="h-eyebrow">Florida · {lang === "es" ? "datos públicos oficiales" : "official public data"}</div>
        <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">{t(lang, "home.title")}</h1>
        <p className="muted mt-3 max-w-2xl text-lg">{t(lang, "home.sub")}</p>
        <div className="mt-6 max-w-3xl">
          <SearchBox placeholder={t(lang, "search.placeholder")} button={t(lang, "search.button")} />
        </div>
        <p className="muted mt-4 text-sm">{t(lang, "search.coverage")}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Link href="/leads" className="card block transition-transform hover:-translate-y-0.5">
          <div className="h-eyebrow">{t(lang, "nav.leads")}</div>
          <div className="mt-1 text-lg font-semibold">{t(lang, "leads.title")}</div>
          <p className="muted mt-1 text-sm">{t(lang, "leads.sub")}</p>
        </Link>
        <Link href="/data" className="card block transition-transform hover:-translate-y-0.5">
          <div className="h-eyebrow">{t(lang, "nav.data")}</div>
          <div className="mt-1 text-lg font-semibold">{t(lang, "data.title")}</div>
          <p className="muted mt-1 text-sm">
            {lang === "es"
              ? "Qué fuentes están activas, qué cubre cada una y cuánto se ha gastado."
              : "Which sources are on, what each one covers, and what has been spent."}
          </p>
        </Link>
        <div className="card">
          <div className="h-eyebrow">{lang === "es" ? "Regla de la casa" : "House rule"}</div>
          <div className="mt-1 text-lg font-semibold">{lang === "es" ? "Sin datos inventados" : "No invented data"}</div>
          <p className="muted mt-1 text-sm">
            {lang === "es"
              ? "Cada número muestra su fuente y fecha. Si falta el dato, dice «Desconocido». Los estimados se marcan como estimados."
              : "Every number shows its source and date. Missing data says “Unknown”. Estimates are labeled as estimates."}
          </p>
        </div>
      </section>
    </div>
  );
}
