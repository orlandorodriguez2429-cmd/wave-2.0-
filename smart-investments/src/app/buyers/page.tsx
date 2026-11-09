import { cookies } from "next/headers";
import Link from "next/link";
import { TYPE_LABEL } from "@/components/ui";
import type { PropertyType } from "@/lib/adapters/types";
import { parseLang } from "@/lib/i18n";
import { findBuyers, RESIDENTIAL_TYPES, type Buyer } from "@/lib/market";
import { zipSnapshot, type ZipSnapshot } from "@/lib/report";
import { fmtDate, fmtMoney } from "@/lib/sourced";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function BuyersPage({ searchParams }: { searchParams: Promise<{ zip?: string; type?: string }> }) {
  const sp = await searchParams;
  const lang = parseLang((await cookies()).get("lang")?.value);
  const es = lang === "es";
  const raw = (sp.zip ?? "").trim();
  const zip = /^\d{5}$/.test(raw) ? raw : null;
  const type = (RESIDENTIAL_TYPES as string[]).includes(sp.type ?? "") ? (sp.type as PropertyType) : null;

  let snap: ZipSnapshot | null = null;
  let buyers: Buyer[] = [];
  let error: string | null = null;
  if (zip) {
    try {
      snap = await zipSnapshot(zip, RESIDENTIAL_TYPES);
      buyers = findBuyers(snap.records);
      if (type) buyers = buyers.filter((b) => b.types.includes(type));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const shown = buyers.slice(0, 100);

  return (
    <div className="stagger flex flex-col gap-5">
      <section className="card">
        <div className="h-eyebrow">{snap?.countyName ? `${snap.countyName} County` : "Florida"}</div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{es ? "Compradores activos" : "Active buyers"}</h1>
        <p className="muted mt-1">
          {es
            ? "Empresas y compradores repetidos que compraron en un código postal en los últimos 12 meses, según los registros del condado."
            : "Companies and repeat buyers who bought in a zip code in the last 12 months, from county records."}
        </p>
        <form className="mt-4 flex max-w-xl flex-wrap gap-2" method="get">
          <input className="input !w-32" name="zip" defaultValue={raw} placeholder="33012" inputMode="numeric" maxLength={5} required aria-label="Zip code" />
          <select className="input !w-auto" name="type" defaultValue={type ?? ""} aria-label="Property type">
            <option value="">{es ? "Todos los tipos" : "All types"}</option>
            {RESIDENTIAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button className="btn">{es ? "Buscar compradores" : "Find buyers"}</button>
        </form>
        {raw && !zip ? <p className="text-bad mt-2 text-sm">Enter a 5-digit zip code.</p> : null}
        <p className="muted mt-3 text-xs">
          {es
            ? "No se sabe si pagaron en efectivo (faltan los registros de hipotecas). No incluye teléfonos ni correos. Quien compró y ya revendió no aparece."
            : "Cash vs financed is not known (needs recorded mortgages). No phones or emails. Anyone who bought and already resold does not appear."}
        </p>
      </section>

      {error ? (
        <section className="card">
          <div className="pill pill-bad">Data source error</div>
          <p className="mt-2">The county data service did not answer, so no buyers can be shown. Try again in a minute.</p>
          <p className="muted mt-1 text-sm">{error}</p>
        </section>
      ) : null}

      {snap ? (
        <section className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-lg font-semibold">
              {buyers.length.toLocaleString("en-US")} {es ? "compradores en" : `buyer${buyers.length === 1 ? "" : "s"} in`} {zip}
              {type ? ` · ${TYPE_LABEL[type]}` : ""}
              {buyers.length > shown.length ? <span className="muted text-sm font-normal"> · {es ? "primeros" : "top"} {shown.length}</span> : null}
            </div>
            <div className="muted text-xs">
              {snap.source}, {es ? "datos al" : "updated"} {fmtDate(snap.dataAsOf)}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="mt-3">{es ? "No se encontraron empresas ni compradores repetidos." : "No companies or repeat buyers found."}</p>
          ) : (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {shown.map((b) => (
                <div key={b.name} className="card-flat">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold">{b.name}</div>
                      <div className="muted text-xs">{b.mailing ?? "Mailing address unknown"}</div>
                    </div>
                    <span className="pill num shrink-0">
                      {b.purchases.length} {es ? "compra" : "purchase"}
                      {b.purchases.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="pill pill-muted">{b.kind === "company" ? (es ? "Empresa" : "Company") : b.kind === "trust" ? "Trust" : es ? "Persona" : "Individual"}</span>
                    {b.types.map((t) => (
                      <span key={t} className="pill pill-muted">
                        {TYPE_LABEL[t]}
                      </span>
                    ))}
                    <span className="pill pill-muted num">
                      {b.minPrice === b.maxPrice ? fmtMoney(b.minPrice) : `${fmtMoney(b.minPrice)} – ${fmtMoney(b.maxPrice)}`}
                    </span>
                    {b.allAbsentee ? <span className="pill pill-good">{es ? "No vive ahí" : "Not owner-occupied"}</span> : null}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {b.purchases.slice(0, 4).map((p) => (
                      <li key={p.folio} className="flex justify-between gap-3">
                        <Link className="text-accent truncate" href={`/property/${p.folio}`}>
                          {p.address}
                        </Link>
                        <span className="num muted shrink-0">
                          {fmtDate(p.date)} · {fmtMoney(p.price)}
                        </span>
                      </li>
                    ))}
                    {b.purchases.length > 4 ? (
                      <li className="muted text-xs">
                        + {b.purchases.length - 4} {es ? "más" : "more"}
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
