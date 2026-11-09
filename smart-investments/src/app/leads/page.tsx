import { cookies } from "next/headers";
import Link from "next/link";
import { scoreTone, TYPE_LABEL } from "@/components/ui";
import type { PropertyType } from "@/lib/adapters/types";
import { titleCase } from "@/lib/analysis/florida";
import { parseLang, t } from "@/lib/i18n";
import { findLeads, type LeadResult } from "@/lib/report";
import { fmtDate, fmtNum } from "@/lib/sourced";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPES: PropertyType[] = ["single_family", "condo", "townhouse", "duplex", "multifamily_small", "multifamily_large", "vacant_land"];

function many(v: string | string[] | undefined): string[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const lang = parseLang((await cookies()).get("lang")?.value);
  const zip = typeof sp.zip === "string" && /^\d{5}$/.test(sp.zip.trim()) ? sp.zip.trim() : null;
  const zipInvalid = typeof sp.zip === "string" && sp.zip.trim() !== "" && !zip;
  const picked = many(sp.type).filter((x): x is PropertyType => (TYPES as string[]).includes(x));
  const types = picked.length ? picked : (["single_family", "duplex", "multifamily_small"] as PropertyType[]);
  const minScore = Math.max(0, Math.min(100, Number(sp.min ?? 15) || 0));
  const absenteeOnly = sp.absentee === "1";

  let result: LeadResult | null = null;
  let error: string | null = null;
  if (zip) {
    try {
      result = await findLeads({ zip, types, minScore, absenteeOnly, limit: 200 });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  return (
    <div className="stagger flex flex-col gap-5">
      <section className="card">
        <div className="h-eyebrow">Miami-Dade</div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{t(lang, "leads.title")}</h1>
        <p className="muted mt-1">{t(lang, "leads.sub")}</p>

        <form className="mt-4 grid gap-4 md:grid-cols-[140px_1fr_140px_auto] md:items-end" method="get">
          <label>
            <span className="label">Zip code</span>
            <input className="input" name="zip" defaultValue={typeof sp.zip === "string" ? sp.zip : ""} placeholder="33012" inputMode="numeric" maxLength={5} required />
          </label>
          <fieldset>
            <span className="label">Property types</span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {TYPES.map((ty) => (
                <label key={ty} className="flex items-center gap-1.5">
                  <input type="checkbox" name="type" value={ty} defaultChecked={types.includes(ty)} />
                  {TYPE_LABEL[ty]}
                </label>
              ))}
              <label className="flex items-center gap-1.5 font-semibold">
                <input type="checkbox" name="absentee" value="1" defaultChecked={absenteeOnly} />
                Absentee owners only
              </label>
            </div>
          </fieldset>
          <label>
            <span className="label">Minimum score</span>
            <input className="input" name="min" type="number" min={0} max={100} defaultValue={minScore} />
          </label>
          <button className="btn">{t(lang, "leads.find")}</button>
        </form>
        {zipInvalid ? <p className="text-bad mt-2 text-sm">Enter a 5-digit zip code.</p> : null}
        <p className="muted mt-3 text-xs">
          A full zip code is scored live from county data, which takes about 20–60 seconds the first time and is then reused for 6 hours.
        </p>
      </section>

      {error ? (
        <section className="card">
          <div className="pill pill-bad">Data source error</div>
          <p className="mt-2">The county data service did not answer, so no leads can be shown. Try again in a minute.</p>
          <p className="muted mt-1 text-sm">{error}</p>
        </section>
      ) : null}

      {result ? (
        <section className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-lg font-semibold">
              {result.matched.toLocaleString("en-US")} lead{result.matched === 1 ? "" : "s"} scoring {minScore}+ in {zip}
              {result.matched > result.leads.length ? <span className="muted text-sm font-normal"> · showing the top {result.leads.length}</span> : null}
            </div>
            <div className="muted text-xs">
              Scanned {result.scanned.toLocaleString("en-US")} of {result.totalInZip.toLocaleString("en-US")} parcels in {(result.elapsedMs / 1000).toFixed(1)}s · Property
              Appraiser data updated {fmtDate(result.dataAsOf)}
            </div>
          </div>

          {result.truncated ? (
            <p className="text-warn mt-2 text-sm">
              This zip has more parcels than one scan covers ({result.totalInZip.toLocaleString("en-US")}). Only the first {result.scanned.toLocaleString("en-US")} were
              scored; pick fewer property types to cover the rest.
            </p>
          ) : null}
          <p className="muted mt-2 text-sm">
            {result.violationsCoveredCount === 0
              ? "Every parcel scanned is inside a city, so county violation data does not apply here. Scores use ownership signals only."
              : result.violationsCoveredCount < result.scanned
                ? `County violation data covers ${result.violationsCoveredCount.toLocaleString("en-US")} of the scanned parcels (the unincorporated ones). City parcels are scored on ownership signals only.`
                : "County violation data covers all scanned parcels."}{" "}
            Pre-foreclosure, tax delinquency, probate, vacancy and equity are not checked yet.
          </p>

          {result.leads.length === 0 ? (
            <p className="mt-4">No properties reach that score with the signals available. Lower the minimum score or add property types.</p>
          ) : (
            <div className="scroll-x mt-3">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Property</th>
                    <th>Why</th>
                    <th>Owner</th>
                    <th className="!text-right">Bd/Ba</th>
                    <th className="!text-right">Sq ft</th>
                    <th className="!text-right">Built</th>
                  </tr>
                </thead>
                <tbody>
                  {result.leads.map((l) => {
                    const tone = scoreTone(l.score);
                    return (
                      <tr key={l.folio}>
                        <td>
                          <span className={`pill pill-${tone} num !text-sm`}>{l.score}</span>
                        </td>
                        <td>
                          <Link className="text-accent font-semibold" href={`/property/${l.folio}`}>
                            {l.address}
                            {l.unit ? ` #${l.unit}` : ""}
                          </Link>
                          <div className="muted text-xs">
                            {l.city ? titleCase(l.city) : ""} · {TYPE_LABEL[l.type]}
                          </div>
                        </td>
                        <td className="min-w-[260px]">
                          <ul className="space-y-0.5">
                            {l.reasons.map((r) => (
                              <li key={r.label} className="text-[13px]">
                                <span className="muted num">+{r.points}</span> {r.label}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td className="text-[13px]">
                          {l.owner ?? "Unknown"}
                          {l.ownerKind !== "individual" && l.ownerKind !== "unknown" ? <div className="muted text-xs">{l.ownerKind}</div> : null}
                        </td>
                        <td className="num text-right">
                          {l.beds ?? "—"}/{l.baths ?? "—"}
                        </td>
                        <td className="num text-right">{l.sqft ? fmtNum(l.sqft) : "—"}</td>
                        <td className="num text-right">{l.yearBuilt ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
