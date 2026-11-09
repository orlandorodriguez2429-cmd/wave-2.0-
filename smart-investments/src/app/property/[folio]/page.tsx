import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Analyzer } from "@/components/Analyzer";
import { PrintButton } from "@/components/chrome";
import { Fact, ScoreRing, Src, TYPE_LABEL, Val } from "@/components/ui";
import { formatFolio } from "@/lib/address";
import { titleCase } from "@/lib/analysis/florida";
import { parseLang, t } from "@/lib/i18n";
import { buildReport, isPropertyId, type DealReport } from "@/lib/report";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/sourced";

export const dynamic = "force-dynamic";

const SIGNAL_LABEL: Record<string, string> = {
  code_violation: "Code violation",
  code_violation_lien: "Code violation with lien",
  foreclosure_registry: "Foreclosed-property registry",
  building_violation: "Building violation",
  unsafe_structure: "Unsafe structure",
  expired_permit: "Expired permit",
};

const OWNER_KIND: Record<string, string> = {
  individual: "Individual",
  company: "Company / LLC",
  trust: "Trust or estate",
  government: "Government",
  unknown: "Unknown",
};

function yesNo(v: boolean | null): string {
  return v === null ? "Unknown" : v ? "Yes" : "No";
}

export default async function PropertyPage({ params }: { params: Promise<{ folio: string }> }) {
  const folio = decodeURIComponent((await params).folio);
  if (!isPropertyId(folio)) notFound();
  const lang = parseLang((await cookies()).get("lang")?.value);
  const L = (en: string, es: string) => (lang === "es" ? es : en);

  let report: DealReport | null;
  try {
    report = await buildReport(folio);
  } catch (e) {
    return (
      <div className="card">
        <div className="pill pill-bad">Data source error</div>
        <p className="mt-2">The county data service did not answer, so this report cannot be shown right now. Try again in a minute.</p>
        <p className="muted mt-1 text-sm">{e instanceof Error ? e.message : String(e)}</p>
      </div>
    );
  }
  if (!report) notFound();

  const p = report.property;
  const o = report.owner;
  const open = report.signals.filter((s) => s.open);
  const paMeta = { source: p.address.source, asOf: p.address.asOf };
  const title = [p.address.value ?? "Address unknown", p.unit.value ? `#${p.unit.value}` : null].filter(Boolean).join(" ");
  const cityLine = [p.city.value ? titleCase(p.city.value) : null, "FL", p.zip.value].filter(Boolean).join(", ").replace(", FL,", ", FL");
  const mapsUrl = p.lat !== null && p.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null;

  return (
    <div className="stagger flex flex-col gap-5">
      {/* ---------- Header ---------- */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="h-eyebrow">
              Deal report · {p.propertyType === "other" ? (p.useDescription.value ?? "Other") : TYPE_LABEL[p.propertyType]}
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <div className="muted mt-1 text-[15px]">
              {cityLine} · {p.countyName} County · {L("Parcel", "Parcela")} <span className="num">{formatFolio(p.parcelId)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {o.absentee ? <span className="pill pill-warn">Absentee owner</span> : null}
              {o.outOfState ? <span className="pill pill-warn">{o.outOfCountry ? "Owner abroad" : "Out-of-state owner"}</span> : null}
              {o.kind !== "individual" && o.kind !== "unknown" ? <span className="pill">{OWNER_KIND[o.kind]}</span> : null}
              {open.length ? <span className="pill pill-bad">{open.length} open county case{open.length === 1 ? "" : "s"}</span> : null}
              {!report.violationsCovered ? <span className="pill pill-muted">Violations: no data here</span> : null}
              {p.homestead.value === false && o.kind === "individual" ? <span className="pill pill-warn">No homestead exemption</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {mapsUrl ? (
              <a className="btn btn-ghost no-print" href={mapsUrl} target="_blank" rel="noreferrer">
                {L("Map / Street View","Mapa / Street View")}
              </a>
            ) : null}
            <form action="/api/pipeline" method="post" className="no-print">
              <input type="hidden" name="_action" value="save" />
              <input type="hidden" name="folio" value={p.folio} />
              <button className="btn btn-ghost">{lang === "es" ? "Guardar en seguimiento" : "Save to pipeline"}</button>
            </form>
            <PrintButton label={t(lang, "report.export")} />
          </div>
        </div>
        <p className="muted mt-4 text-xs">
          {p.address.source}, updated {fmtDate(p.address.asOf)} · report built {fmtDate(report.generatedAt)} in {(report.elapsedMs / 1000).toFixed(1)}s. Hover the
          small “i” next to any number for its source.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* ---------- Snapshot ---------- */}
        <section className="card lg:col-span-2">
          <div className="h-eyebrow">{t(lang, "report.snapshot")}</div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Fact label={L("Beds","Habitaciones")}>
              <Val s={p.beds} />
            </Fact>
            <Fact label={L("Baths","Baños")}>
              <span className="num">
                {p.baths.value ?? <span className="muted">Unknown</span>}
                {p.halfBaths.value ? ` + ${p.halfBaths.value} half` : ""}
                <Src {...paMeta} />
              </span>
            </Fact>
            <Fact label={L("Heated sq ft","Pies² habitables")}>
              <Val s={p.heatedSqft} format={fmtNum} />
            </Fact>
            <Fact label={L("Lot sq ft","Pies² del lote")}>
              <Val s={p.lotSqft} format={fmtNum} />
            </Fact>
            <Fact label={L("Year built","Año de construcción")}>
              <Val s={p.yearBuilt} />
            </Fact>
            <Fact label={L("Units","Unidades")}>
              <Val s={p.units} />
            </Fact>
            <Fact label={L("Floors","Pisos")}>
              <Val s={p.floors} />
            </Fact>
            <Fact label={L("County use code","Código de uso del condado")}>
              <Val s={p.useCode} />
            </Fact>
            <Fact label={`Assessed value${p.assessmentYear.value ? ` (${p.assessmentYear.value})` : ""}`}>
              <Val s={p.assessedValue} format={fmtMoney} />
            </Fact>
            <Fact label={L("Appraiser market value", "Valor de mercado (tasador)")}>
              <Val s={p.justValue} format={fmtMoney} />
            </Fact>
            <Fact label={L("Last deed transfer","Último traspaso de escritura")}>
              <Val s={p.lastTransferDate} format={fmtDate} unknown={p.olderTransfersUnknown ? "None since 2024" : "None on record"} />
            </Fact>
            <Fact label={L("Transfer price","Precio del traspaso")}>
              <span className="num">
                {p.lastTransferPrice.value === null ? <span className="muted">Unknown</span> : fmtMoney(p.lastTransferPrice.value)}
                <Src {...paMeta} note={p.lastTransferPrice.note} />
              </span>
              {o.lastTransferWasMarketSale === false ? <div className="muted text-xs font-normal">Not a market sale</div> : null}
            </Fact>
            <Fact label={L("Flood zone (FEMA)","Zona de inundación (FEMA)")}>
              {report.flood ? (
                <span>
                  {report.flood.zone}
                  {report.flood.sfha ? <span className="pill pill-warn ml-2">High risk</span> : null}
                  <Src source={report.flood.source} asOf={report.flood.fetchedAt} note="A lot can straddle two zones. Not a lender flood determination." />
                </span>
              ) : (
                <span className="muted">{report.floodLookupFailed ? "Unknown (FEMA did not answer)" : "Unknown (not mapped)"}</span>
              )}
            </Fact>
            <Fact label={L("Years since transfer","Años desde el traspaso")}>
              <span className="num">{o.yearsSinceTransfer ?? <span className="muted">Unknown</span>}</span>
            </Fact>
          </div>
          <div className="card-flat mt-4 text-sm">
            <strong>Not available from the free data:</strong> zoning, HOA details, current tax bill, mortgages and liens, equity, photos{p.county === "miami-dade" ? "" : ", bedrooms and bathrooms, sales older than about two years"}.
            These show as Unknown until the paid or clerk adapters are switched on.
          </div>
        </section>

        {/* ---------- Score ---------- */}
        <section className="card">
          <div className="h-eyebrow">{t(lang, "report.score")}</div>
          <div className="mt-3 flex items-center gap-4">
            <ScoreRing score={report.score.score} />
            <div className="text-sm">
              <div className="font-semibold">{t(lang, "report.whyScore")}</div>
              {report.score.reasons.length === 0 ? <div className="muted">{t(lang, "report.noSignals")}</div> : null}
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {report.score.reasons.map((r) => (
              <li key={r.label} className="flex gap-2">
                <span className="pill num shrink-0 self-start">+{r.points}</span>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
          <details className="mt-3">
            <summary className="muted cursor-pointer text-xs font-semibold">
              {t(lang, "report.notChecked")} ({report.score.notChecked.length})
            </summary>
            <ul className="muted mt-1 list-disc space-y-0.5 pl-4 text-xs">
              {report.score.notChecked.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            <p className="muted mt-1 text-xs">A low score means “nothing found in the sources that are on”, not “no distress”.</p>
          </details>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------- Owner ---------- */}
        <section className="card">
          <div className="h-eyebrow">{t(lang, "report.owner")}</div>
          <div className="mt-2 text-xl font-semibold">
            {p.owners.value ? p.owners.value.join(" & ") : <span className="muted">Unknown</span>}
            <Src {...paMeta} />
          </div>
          <div className="muted text-sm">{OWNER_KIND[o.kind]} (classified from the name)</div>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3">
            <Fact label={L("Mailing address","Dirección postal")}>
              <span className="text-sm">
                {p.mailingAddress.value ?? <span className="muted">Unknown</span>}
                <br />
                {[p.mailingCity.value ? titleCase(p.mailingCity.value) : null, p.mailingState.value, p.mailingZip.value].filter(Boolean).join(", ")}
                {p.mailingCountry.value && !["USA", "US"].includes(p.mailingCountry.value) ? ` · ${p.mailingCountry.value}` : ""}
                <Src {...paMeta} />
              </span>
            </Fact>
            <div className="space-y-1 text-sm">
              <div className="row !py-0.5">
                <span>{L("Absentee","Dueño ausente")}</span>
                <span>{yesNo(o.absentee)}</span>
              </div>
              <div className="row !py-0.5">
                <span>{L("Out of state","Fuera del estado")}</span>
                <span>{yesNo(o.outOfState)}</span>
              </div>
              <div className="row !py-0.5">
                <span>{L("Homestead exemption", "Exención de homestead")}</span>
                <span>
                  {p.homestead.value === null ? <span className="muted">Unknown</span> : p.homestead.value ? "Yes" : "No"}
                  {p.homestead.value !== null ? <Src source={p.homestead.source} asOf={p.homestead.asOf} note={p.homestead.note} /> : null}
                </span>
              </div>
              <div className="row !py-0.5">
                <span>{L("Mortgage / equity","Hipoteca / capital")}</span>
                <span className="muted">Unknown</span>
              </div>
            </div>
          </div>
          {o.kind === "company" ? (
            <p className="muted mt-3 text-xs">
              Company owner: look up the people behind it on Sunbiz (Florida Division of Corporations). Automatic lookup is not built yet.
            </p>
          ) : null}
        </section>

        {/* ---------- Signals ---------- */}
        <section className="card">
          <div className="h-eyebrow">{t(lang, "report.signals")}</div>
          {!report.violationsCovered ? (
            <p className="mt-2 text-sm">
              <span className="pill pill-muted mr-2">Unknown</span>
              {p.county === "miami-dade"
                ? `This property is in ${p.city.value ? titleCase(p.city.value) : "a city"}, which runs its own code enforcement. The county's violation data only covers unincorporated Miami-Dade, so nothing can be said here either way.`
                : `No code-violation data source is connected for ${p.countyName} County yet, so nothing can be said here either way.`}
            </p>
          ) : report.signals.length === 0 ? (
            <p className="mt-2 text-sm">
              No county code-compliance or building-violation cases on file for this folio.
              <Src source="Miami-Dade Code Compliance + Building Violations (county open data)" note="Updated daily by the county." />
            </p>
          ) : (
            <div className="scroll-x mt-2">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{L("Status","Estado")}</th>
                    <th>{L("Type","Tipo")}</th>
                    <th>{L("Detail","Detalle")}</th>
                    <th>{L("Opened","Abierto")}</th>
                    <th>{L("Case","Caso")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.signals.slice(0, 12).map((s) => (
                    <tr key={`${s.type}-${s.caseNumber}`}>
                      <td>
                        <span className={`pill ${s.open ? "pill-bad" : "pill-muted"}`}>{s.open ? s.status : "Closed"}</span>
                      </td>
                      <td>{SIGNAL_LABEL[s.type]}</td>
                      <td>{s.description}</td>
                      <td className="num">{fmtDate(s.openedAt)}</td>
                      <td className="num">
                        {s.caseNumber}
                        <Src source={s.source} asOf={s.asOf} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.signals.length > 12 ? <p className="muted mt-2 text-xs">Showing the 12 most recent of {report.signals.length} cases.</p> : null}
            </div>
          )}
        </section>
      </div>

      {/* ---------- Analyzer (value, inputs, strategies) ---------- */}
      <Analyzer
        lang={lang}
        county={p.county}
        type={p.propertyType}
        folio={p.folio}
        heatedSqft={p.heatedSqft.value}
        lotSqft={p.lotSqft.value}
        units={p.units.value}
        comps={report.comps}
        tierIndex={report.compTierIndex}
        tierLabel={report.compTierLabel}
        compSource={report.compSource}
        compAsOf={p.address.asOf}
      />

      {/* ---------- Florida checks ---------- */}
      <section className="card">
        <div className="h-eyebrow">{t(lang, "report.gotchas")}</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {report.gotchas.map((g) => (
            <div key={g.key} className="card-flat">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{g.title}</div>
                <span className={`pill ${g.status === "warning" ? "pill-warn" : g.status === "unknown" ? "pill-muted" : "pill-good"}`}>
                  {g.status === "warning" ? "Check" : g.status === "unknown" ? "Unknown" : "OK"}
                </span>
              </div>
              <p className="mt-1 text-sm">{g.detail}</p>
            </div>
          ))}
        </div>
        <p className="muted mt-3 text-xs">
          Deed doc stamps are included in the flip numbers above (Miami-Dade: $0.60 per $100, plus $0.45 surtax unless it is a single-family residence). Confirm all
          closing figures with the title company.
        </p>
      </section>

      {/* ---------- Approach ---------- */}
      <section className="card">
        <div className="h-eyebrow">{t(lang, "report.approach")}</div>
        <div className="mt-2">
          <div className="label">{t(lang, "approach.angle")}</div>
          <p className="text-[15px]">{report.approach.angle[lang]}</p>
        </div>
        {report.approach.angleKey !== "government" ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(["en", "es"] as const).map((l) => (
              <div key={l} className="card-flat">
                <div className="label">
                  {t(lang, "approach.call")} · {l === "en" ? "English" : "Español"}
                </div>
                <p className="text-sm leading-relaxed">{report.approach.callScript[l]}</p>
                <div className="label mt-3">
                  {t(lang, "approach.letter")} · {l === "en" ? "English" : "Español"}
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed">{report.approach.letter[l]}</p>
              </div>
            ))}
          </div>
        ) : null}
        <p className="text-warn mt-3 text-xs font-medium">{t(lang, "approach.review")}</p>
      </section>

      {p.zip.value && p.propertyType !== "other" ? (
        <section className="card no-print flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">{L("Who is buying around here?", "¿Quién está comprando por aquí?")}</div>
            <div className="muted text-sm">
              {L(
                "Companies and repeat buyers who bought this property type in this zip code in the last 12 months.",
                "Empresas y compradores repetidos que compraron este tipo de propiedad en este código postal en los últimos 12 meses.",
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Link className="btn btn-ghost" href={`/buyers?zip=${p.zip.value}&type=${p.propertyType}`}>
              {L("Find buyers", "Buscar compradores")}
            </Link>
            <Link className="btn btn-ghost" href={`/market?zip=${p.zip.value}`}>
              {L("Zip market", "Mercado del código postal")}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="no-print flex justify-between">
        <Link href="/" className="btn btn-ghost">
          ← {L("New search","Nueva búsqueda")}
        </Link>
        <PrintButton label={t(lang, "report.export")} />
      </div>
    </div>
  );
}
