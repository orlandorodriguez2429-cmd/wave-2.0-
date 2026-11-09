import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SearchBox } from "@/components/SearchBox";
import { TYPE_LABEL } from "@/components/ui";
import { formatFolio } from "@/lib/address";
import { parseLang, t } from "@/lib/i18n";
import { lookup, type LookupResult } from "@/lib/report";

export const dynamic = "force-dynamic";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const lang = parseLang((await cookies()).get("lang")?.value);

  let result: LookupResult | null = null;
  let error: string | null = null;
  try {
    result = await lookup(q);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (result?.kind === "one") redirect(`/property/${result.folio}`);

  return (
    <div className="stagger flex flex-col gap-5">
      <div className="card">
        <SearchBox placeholder={t(lang, "search.placeholder")} button={t(lang, "search.button")} initial={q} />
      </div>

      {error ? (
        <div className="card">
          <div className="pill pill-bad">Data source error</div>
          <p className="mt-2">The county data service did not answer, so nothing can be shown for this search. Try again in a minute.</p>
          <p className="muted mt-1 text-sm">{error}</p>
        </div>
      ) : null}

      {result?.kind === "none" ? (
        <div className="card">
          <div className="text-lg font-semibold">
            {t(lang, "search.none")} “{q}”.
          </div>
          <p className="muted mt-1 text-sm">
            Tried the county spelling “{result.tried}”
            {result.geocoded ? " and a map lookup of the address" : ""}. Check the house number and street, or paste the 13-digit folio.
          </p>
          <p className="muted mt-2 text-sm">{t(lang, "search.coverage")}</p>
        </div>
      ) : null}

      {result?.kind === "many" ? (
        <div className="card">
          <div className="text-lg font-semibold">{t(lang, "search.many")}</div>
          <div className="scroll-x mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Address</th>
                  <th>City</th>
                  <th>Type</th>
                  <th>Owner</th>
                  <th>Folio</th>
                </tr>
              </thead>
              <tbody>
                {result.matches.map((m) => (
                  <tr key={m.folio}>
                    <td>
                      <Link className="text-accent font-semibold" href={`/property/${m.folio}`}>
                        {m.address.value} {m.unit.value ? `#${m.unit.value}` : ""}
                      </Link>
                    </td>
                    <td>
                      {m.city.value} {m.zip.value}
                    </td>
                    <td>{m.propertyType === "other" ? (m.useDescription.value ?? "Other") : TYPE_LABEL[m.propertyType]}</td>
                    <td>{m.owners.value?.[0] ?? "Unknown"}</td>
                    <td className="num">{formatFolio(m.folio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
