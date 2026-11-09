import { cookies } from "next/headers";
import { listAdapters } from "@/lib/adapters/registry";
import { parseLang, t } from "@/lib/i18n";
import { DEFAULT_WEIGHTS } from "@/lib/analysis/score";
import { fmtDate, fmtMoney } from "@/lib/sourced";

export const dynamic = "force-dynamic";

const WEIGHT_LABEL: Record<string, [string, boolean]> = {
  preForeclosure: ["Pre-foreclosure / foreclosure registry", true],
  auctionScheduled: ["Auction date set", false],
  taxDelinquent: ["Tax delinquent", false],
  probate: ["Probate", false],
  codeViolation: ["Code or building violation", true],
  unsafeStructure: ["Unsafe structure", true],
  evictionFiled: ["Eviction filed", false],
  vacant: ["Vacant", false],
  absentee: ["Absentee owner", true],
  outOfState: ["Out-of-state owner", true],
  highEquity: ["High equity (50%+)", false],
  freeAndClear: ["Free and clear", false],
  longOwnership: ["No deed transfer in 15+ years", true],
  condoSpecialAssessment: ["Condo special assessment", false],
  expiredListing: ["Expired listing", false],
  expiredPermit: ["Expired permit", true],
  violationLien: ["Code violation with lien", true],
};

export default async function DataPage() {
  const lang = parseLang((await cookies()).get("lang")?.value);
  const adapters = listAdapters();
  const live = adapters.filter((a) => a.enabled);
  const off = adapters.filter((a) => !a.enabled);

  return (
    <div className="stagger flex flex-col gap-5">
      <section className="card">
        <h1 className="text-3xl font-bold tracking-tight">{t(lang, "data.title")}</h1>
        <p className="muted mt-1">
          Each data type comes through an adapter. Free ones are on. Paid ones switch on by adding their key to the environment once their code is built; nothing else
          changes.
        </p>
      </section>

      <section className="card">
        <div className="h-eyebrow">On now · $0</div>
        <div className="scroll-x mt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>Source</th>
                <th>Gives us</th>
                <th>Covers</th>
                <th>Limits</th>
                <th className="!text-right">Calls since restart</th>
                <th className="!text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {live.map((a) => (
                <tr key={a.id}>
                  <td className="font-semibold">
                    {a.name} <span className="pill pill-good ml-1">On</span>
                  </td>
                  <td>{a.dataTypes.join(", ")}</td>
                  <td>{a.coverage}</td>
                  <td className="min-w-[220px] text-[13px]">{a.note}</td>
                  <td className="num text-right">
                    {a.callsThisSession}
                    {a.lastCallAt ? <div className="muted text-xs">last {fmtDate(a.lastCallAt)}</div> : null}
                  </td>
                  <td className="num text-right">{fmtMoney(a.costThisSession)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted mt-2 text-xs">Counts reset when the server restarts until the database is connected.</p>
      </section>

      <section className="card">
        <div className="h-eyebrow">Not connected yet</div>
        <div className="scroll-x mt-2">
          <table className="tbl">
            <thead>
              <tr>
                <th>Source</th>
                <th>Would give us</th>
                <th>Tier</th>
                <th>Key</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {off.map((a) => (
                <tr key={a.id}>
                  <td className="font-semibold">{a.name}</td>
                  <td>{a.dataTypes.join(", ")}</td>
                  <td>
                    <span className="pill pill-muted">{a.tier}</span>
                  </td>
                  <td className="num text-[13px]">{a.envKey ? `${a.envKey}${a.keyPresent ? " (set)" : " (not set)"}` : "—"}</td>
                  <td className="min-w-[240px] text-[13px]">{a.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="h-eyebrow">Motivation score weights</div>
        <p className="muted mt-1 text-sm">Points from your build brief. Rows marked “no data yet” cannot add points until their source is connected.</p>
        <div className="mt-3 grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {Object.entries(DEFAULT_WEIGHTS).map(([key, points]) => {
            const [label, on] = WEIGHT_LABEL[key] ?? [key, false];
            return (
              <div key={key} className="row">
                <span style={{ color: on ? "var(--text)" : undefined }}>
                  {label} {on ? null : <span className="pill pill-muted ml-1">no data yet</span>}
                </span>
                <span>+{points}</span>
              </div>
            );
          })}
        </div>
        <p className="muted mt-2 text-xs">Editing weights from this screen comes with the Settings screen in Phase 3.</p>
      </section>
    </div>
  );
}
