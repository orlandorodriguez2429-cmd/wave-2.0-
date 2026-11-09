import { cookies } from "next/headers";
import Link from "next/link";
import { Src, TYPE_LABEL } from "@/components/ui";
import { parseLang } from "@/lib/i18n";
import { marketStats, RESIDENTIAL_TYPES, type MarketStats } from "@/lib/market";
import { zipSnapshot, type ZipSnapshot } from "@/lib/report";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/sourced";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE = "Computed from Miami-Dade Property Appraiser records (Property Point View): each parcel's most recent deed transfer";

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ zip?: string }> }) {
  const sp = await searchParams;
  const lang = parseLang((await cookies()).get("lang")?.value);
  const es = lang === "es";
  const raw = (sp.zip ?? "").trim();
  const zip = /^\d{5}$/.test(raw) ? raw : null;

  let snap: ZipSnapshot | null = null;
  let stats: MarketStats | null = null;
  let error: string | null = null;
  if (zip) {
    try {
      snap = await zipSnapshot(zip, RESIDENTIAL_TYPES);
      stats = marketStats(snap.records);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const tile = (label: string, value: string, note: string) => (
    <div className="card-flat">
      <div className="muted text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className="num mt-1 text-2xl font-bold">
        {value}
        <Src estimate source={SOURCE} asOf={snap?.dataAsOf} note={note} />
      </div>
    </div>
  );

  return (
    <div className="stagger flex flex-col gap-5">
      <section className="card">
        <div className="h-eyebrow">Miami-Dade</div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{es ? "Mercado por código postal" : "Market by zip code"}</h1>
        <p className="muted mt-1">
          {es
            ? "Precios, tendencia y quién está comprando, calculado de los registros del condado."
            : "Prices, trend and who is buying, computed from county records."}
        </p>
        <form className="mt-4 flex max-w-md gap-2" method="get">
          <input className="input" name="zip" defaultValue={raw} placeholder="33012" inputMode="numeric" maxLength={5} required aria-label="Zip code" />
          <button className="btn shrink-0">{es ? "Ver mercado" : "Show market"}</button>
        </form>
        {raw && !zip ? <p className="text-bad mt-2 text-sm">Enter a 5-digit zip code.</p> : null}
        <p className="muted mt-3 text-xs">{es ? "La primera carga de un código postal tarda 20–60 segundos." : "The first load of a zip code takes 20–60 seconds."}</p>
      </section>

      {error ? (
        <section className="card">
          <div className="pill pill-bad">Data source error</div>
          <p className="mt-2">The county data service did not answer, so no market figures can be shown. Try again in a minute.</p>
          <p className="muted mt-1 text-sm">{error}</p>
        </section>
      ) : null}

      {stats && snap && stats.parcels === 0 ? (
        <section className="card">No residential parcels found for {zip} in Miami-Dade County.</section>
      ) : null}

      {stats && snap && stats.parcels > 0 ? (
        <>
          <section className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="h-eyebrow">
                {zip} · {es ? "últimos 12 meses" : "last 12 months"}
              </div>
              <div className="muted text-xs">
                {stats.parcels.toLocaleString("en-US")} {es ? "parcelas residenciales" : "residential parcels"} · {es ? "datos al" : "data as of"}{" "}
                {fmtDate(snap.dataAsOf)}
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tile(es ? "Ventas de mercado" : "Market sales", stats.sales12m.toLocaleString("en-US"), "Transfers of $10,000+ and at least half of assessed value.")}
              {tile(
                es ? "Compras de inversionistas" : "Investor purchases",
                fmtPct(stats.investorShare, 0),
                "Share of last-12-month buyers that are a company or whose mailing address differs from the property.",
              )}
              {tile(es ? "Dueños ausentes" : "Absentee owners", fmtPct(stats.absenteeShare, 0), "Share of all parcels whose mailing address differs from the property.")}
              {tile(es ? "15+ años sin traspaso" : "No transfer in 15+ years", fmtPct(stats.longOwnershipShare, 0), "Share of parcels with a transfer date on record.")}
            </div>
            {snap.truncated ? <p className="text-warn mt-3 text-sm">This zip has more parcels than one scan covers; figures use the first {snap.records.length.toLocaleString("en-US")}.</p> : null}
          </section>

          <section className="card">
            <div className="h-eyebrow">{es ? "Por tipo de propiedad" : "By property type"}</div>
            <div className="scroll-x mt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{es ? "Tipo" : "Type"}</th>
                    <th className="!text-right">{es ? "Parcelas" : "Parcels"}</th>
                    <th className="!text-right">{es ? "Ventas 12 m" : "Sales 12 mo"}</th>
                    <th className="!text-right">{es ? "Rotación" : "Turnover"}</th>
                    <th className="!text-right">{es ? "Precio mediano" : "Median price"}</th>
                    <th className="!text-right">$/{es ? "pie²" : "sq ft"}</th>
                    <th className="!text-right">{es ? "Últimos 6 m" : "Last 6 mo"}</th>
                    <th className="!text-right">{es ? "6 m anteriores" : "Prior 6 mo"}</th>
                    <th className="!text-right">{es ? "Tendencia" : "Trend"}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byType.map((t) => (
                    <tr key={t.type}>
                      <td className="font-semibold">{TYPE_LABEL[t.type]}</td>
                      <td className="num text-right">{t.parcels.toLocaleString("en-US")}</td>
                      <td className="num text-right">{t.sales12m.toLocaleString("en-US")}</td>
                      <td className="num text-right">{fmtPct(t.turnover)}</td>
                      <td className="num text-right">{t.medianPrice === null ? "—" : fmtMoney(t.medianPrice)}</td>
                      <td className="num text-right">{t.medianPerSqft === null ? "—" : fmtMoney(t.medianPerSqft)}</td>
                      <td className="num text-right">{t.recent6PerSqft === null ? "—" : fmtMoney(t.recent6PerSqft)}</td>
                      <td className="num text-right">{t.prior6PerSqft === null ? "—" : fmtMoney(t.prior6PerSqft)}</td>
                      <td className={`num text-right font-semibold ${t.trend === null ? "" : t.trend >= 0 ? "text-good" : "text-bad"}`}>
                        {t.trend === null ? "—" : `${t.trend >= 0 ? "+" : ""}${(t.trend * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted mt-3 text-sm">
              {es
                ? "Tendencia = $/pie² mediano de los últimos 6 meses contra los 6 anteriores; «—» si alguna mitad tiene menos de 5 ventas. Límite: el condado solo publica el último traspaso de cada parcela, así que una casa comprada y revendida en el año cuenta una sola vez."
                : "Trend = median $/sq ft of the last 6 months against the 6 before; “—” when either half has fewer than 5 sales. Limit: the county publishes only each parcel's latest transfer, so a house bought and resold within the year counts once."}
            </p>
            <p className="muted mt-1 text-sm">
              {es ? "No disponible aún: rentas, días en el mercado, inventario (requieren MLS o una fuente de rentas)." : "Not available yet: rents, days on market, inventory (they need MLS or a rent data source)."}
            </p>
          </section>

          <div className="no-print flex flex-wrap gap-2">
            <Link className="btn" href={`/buyers?zip=${zip}`}>
              {es ? "Ver compradores en" : "See buyers in"} {zip}
            </Link>
            <Link className="btn btn-ghost" href={`/leads?zip=${zip}`}>
              {es ? "Buscar prospectos en" : "Find leads in"} {zip}
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
