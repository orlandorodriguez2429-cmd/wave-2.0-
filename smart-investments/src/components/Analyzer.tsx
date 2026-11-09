"use client";

import { useMemo, useState } from "react";
import type { County, PropertyType, SaleComp } from "@/lib/adapters/types";
import { estimateValue } from "@/lib/analysis/comps";
import { deedDocStamps } from "@/lib/analysis/florida";
import {
  brrrr,
  dealGrade,
  DEFAULT_ASSUMPTIONS,
  flip,
  listingCommission,
  quickRepair,
  rental,
  sellerFinancePayment,
  subjectTo,
  wholesale,
  type Assumptions,
  type RepairLevel,
} from "@/lib/analysis/strategies";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { fmtDate, fmtMoney, fmtPct } from "@/lib/sourced";
import { Src } from "./ui";

interface Props {
  lang: Lang;
  county: County;
  type: PropertyType;
  folio: string;
  heatedSqft: number | null;
  lotSqft: number | null;
  units: number | null;
  comps: SaleComp[];
  tierIndex: number | null;
  tierLabel: string | null;
  compSource: string;
  compAsOf: string | null;
}

function NumField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  placeholder,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="relative block">
        {prefix ? <span className="muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">{prefix}</span> : null}
        <input
          className="input"
          style={{ paddingLeft: prefix ? 24 : undefined, paddingRight: suffix ? 44 : undefined }}
          inputMode="decimal"
          value={value === null ? "" : String(value)}
          placeholder={placeholder ?? "Unknown"}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, "");
            onChange(raw === "" ? null : Number(raw));
          }}
        />
        {suffix ? <span className="muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs">{suffix}</span> : null}
      </span>
      {hint ? <span className="muted mt-1 block text-[11.5px] leading-snug">{hint}</span> : null}
    </label>
  );
}

function Row({ label, value, tone, total }: { label: string; value: string; tone?: "good" | "bad" | "warn"; total?: boolean }) {
  return (
    <div className={`row ${total ? "total" : ""}`}>
      <span>{label}</span>
      <span className={tone ? `text-${tone}` : ""}>{value}</span>
    </div>
  );
}

const pctField = (v: number) => Math.round(v * 1000) / 10;

export function Analyzer(p: Props) {
  const es = p.lang === "es";
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [arvOverride, setArvOverride] = useState<number | null>(null);
  const [purchase, setPurchase] = useState<number | null>(null);
  const [repairLevel, setRepairLevel] = useState<RepairLevel | "custom">("medium");
  const [repairCustom, setRepairCustom] = useState<number | null>(null);
  const [rent, setRent] = useState<number | null>(null);
  const [insurance, setInsurance] = useState<number | null>(null);
  const [hoa, setHoa] = useState<number | null>(null);
  const [sfDown, setSfDown] = useState<number | null>(10);
  const [sfRate, setSfRate] = useState<number | null>(5);
  const [sfYears, setSfYears] = useState<number | null>(30);
  const [stBalance, setStBalance] = useState<number | null>(null);
  const [stPayment, setStPayment] = useState<number | null>(null);
  const [stCash, setStCash] = useState<number | null>(null);
  const [listPct, setListPct] = useState<number | null>(2.5);
  const [split, setSplit] = useState<number | null>(null);

  const used = useMemo(() => p.comps.filter((c) => !excluded.has(c.folio)), [p.comps, excluded]);
  const value = useMemo(
    () => (p.tierIndex === null ? null : estimateValue({ heatedSqft: p.heatedSqft, lotSqft: p.lotSqft }, used, p.tierIndex)),
    [used, p.tierIndex, p.heatedSqft, p.lotSqft],
  );

  const arv = arvOverride ?? value?.likely ?? null;
  const repairs =
    repairLevel === "custom" ? repairCustom : p.heatedSqft ? quickRepair(p.heatedSqft, repairLevel, a) : null;

  const w = arv !== null && repairs !== null ? wholesale(arv, repairs, a) : null;
  const stamps = arv !== null ? deedDocStamps(arv, p.county, p.type) : 0;
  const f = arv !== null && repairs !== null && purchase !== null ? flip({ arv, purchase, repairs, insuranceAnnual: insurance, docStampsOnSale: stamps, a }) : null;
  const r = purchase !== null && rent !== null ? rental({ purchase, repairs: repairs ?? 0, monthlyRent: rent, insuranceAnnual: insurance, hoaMonthly: hoa, units: p.units, a }) : null;
  const b = arv !== null && repairs !== null && purchase !== null && rent !== null ? brrrr({ arv, purchase, repairs, monthlyRent: rent, insuranceAnnual: insurance, hoaMonthly: hoa, a }) : null;
  const lowConfidence = arvOverride === null && (value?.confidence ?? "low") === "low";
  const grade = arv !== null && repairs !== null && purchase !== null ? dealGrade(purchase, repairs, arv, lowConfidence) : null;

  const sf =
    purchase !== null && sfDown !== null && sfRate !== null && sfYears !== null && sfYears > 0
      ? sellerFinancePayment({ price: purchase, downPayment: purchase * (sfDown / 100), rate: sfRate / 100, amortYears: sfYears })
      : null;
  const st =
    stBalance !== null && stPayment !== null
      ? subjectTo({ loanBalance: stBalance, loanPaymentMonthly: stPayment, cashToSeller: stCash ?? 0, arrears: 0, monthlyRent: rent, otherMonthlyCosts: (insurance ?? 0) / 12 + (hoa ?? 0) })
      : null;
  const commission = arv !== null && listPct !== null && split !== null ? listingCommission(arv, listPct / 100, split / 100) : null;

  const missing: string[] = [];
  if (arv === null) missing.push(es ? "ARV (sin comparables; escríbalo usted)" : "ARV (no comps; enter your own)");
  if (repairs === null) missing.push(es ? "Reparaciones (falta el área; escriba un monto)" : "Repairs (no square footage; enter an amount)");
  if (purchase === null) missing.push(es ? "Precio de compra" : "Purchase price");
  if (rent === null) missing.push(es ? "Renta mensual (aún no hay fuente de rentas conectada)" : "Monthly rent (no rent data source connected yet)");
  if (insurance === null) missing.push(es ? "Seguro anual (pida una cotización real)" : "Annual insurance (get a real quote)");

  let verdict: string | null = null;
  if (w && purchase !== null && f) {
    if (purchase <= w.mao) {
      verdict = es
        ? `A ${fmtMoney(purchase)} está en o por debajo de su oferta máxima (${fmtMoney(w.mao)}). Sirve para mayoreo (wholesale) y para remodelar y vender.`
        : `At ${fmtMoney(purchase)} you are at or under your maximum offer (${fmtMoney(w.mao)}). It works as a wholesale and as a flip.`;
    } else if (arv !== null && f.profit >= 0.1 * arv) {
      verdict = es
        ? `Muy caro para mayoreo (su máximo es ${fmtMoney(w.mao)}), pero como remodelación deja ${fmtMoney(f.profit)} con estos supuestos.`
        : `Too high to wholesale (your max is ${fmtMoney(w.mao)}), but as a flip it shows ${fmtMoney(f.profit)} profit on these assumptions.`;
    } else if (r && r.cashFlowMonthly > 0 && (r.dscr ?? 0) >= 1.2) {
      verdict = es
        ? `No funciona como mayoreo ni remodelación a este precio. Como renta deja ${fmtMoney(r.cashFlowMonthly)} al mes con cobertura de deuda de ${(r.dscr as number).toFixed(2)}.`
        : `Doesn't work as a wholesale or flip at this price. As a rental it shows ${fmtMoney(r.cashFlowMonthly)}/month with a ${(r.dscr as number).toFixed(2)} debt coverage ratio.`;
    } else {
      verdict = es
        ? `A ${fmtMoney(purchase)} ninguna estrategia en efectivo funciona con estos supuestos. Ofrezca ${fmtMoney(w.target)} o menos, o explore financiamiento del vendedor o tomarla como listado.`
        : `At ${fmtMoney(purchase)} none of the cash strategies work on these assumptions. Offer ${fmtMoney(w.target)} or less, or look at seller financing or taking it as a listing.`;
    }
  }

  const gradeTone = grade ? (grade.grade === "A" || grade.grade === "B" ? "good" : grade.grade === "C" ? "warn" : "bad") : null;
  const setPct = (key: keyof Assumptions) => (v: number | null) => setA((prev) => ({ ...prev, [key]: (v ?? 0) / 100 }));
  const setNum = (key: keyof Assumptions) => (v: number | null) => setA((prev) => ({ ...prev, [key]: v ?? 0 }));

  return (
    <div className="flex flex-col gap-5">
      {/* ---------- Value ---------- */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="h-eyebrow">{t(p.lang, "report.value")}</div>
            {value && value.likely !== null ? (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-3xl font-bold num">{fmtMoney(value.likely)}</span>
                <span className="muted num text-sm">
                  {es ? "rango" : "range"} {fmtMoney(value.low)} – {fmtMoney(value.high)}
                </span>
                <Src
                  estimate
                  source={`Median of ${value.compCount} county-recorded sales (${p.tierLabel}), same use code, heated area within ±20%. ${p.compSource}`}
                  asOf={p.compAsOf}
                />
              </div>
            ) : (
              <div className="mt-1 text-2xl font-bold">{t(p.lang, "report.unknown")}</div>
            )}
          </div>
          {value && value.likely !== null ? (
            <span className={`pill ${value.confidence === "high" ? "pill-good" : value.confidence === "medium" ? "pill-warn" : "pill-bad"}`}>
              {es ? "Confianza" : "Confidence"}: {value.confidence}
            </span>
          ) : null}
        </div>
        <p className="muted mt-2 text-sm">
          {p.comps.length === 0
            ? es
              ? "No se encontraron ventas de mercado comparables en los registros del condado dentro de 1 milla y 12 meses. Escriba su propio ARV abajo."
              : "No comparable market sales were found in county records within 1 mile and 12 months. Enter your own ARV below."
            : es
              ? "Es un estimado del valor actual (tal como está), no el ARV: los registros del condado no indican la condición ni si la casa fue remodelada. Quite las ventas que no apliquen y ajuste el ARV abajo."
              : "This is an as-is market estimate, not ARV: county records don't show condition or whether a sale was renovated. Untick sales that don't fit and set your ARV below."}
        </p>

        {p.comps.length > 0 ? (
          <div className="scroll-x mt-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{es ? "Usar" : "Use"}</th>
                  <th>{es ? "Dirección" : "Address"}</th>
                  <th>{es ? "Vendida" : "Sold"}</th>
                  <th className="!text-right">{es ? "Precio" : "Price"}</th>
                  <th className="!text-right">{es ? "Pies²" : "Sq ft"}</th>
                  <th className="!text-right">$/{es ? "pie²" : "sq ft"}</th>
                  <th className="!text-right">{es ? "Hab/Baños" : "Bd/Ba"}</th>
                  <th className="!text-right">{es ? "Año" : "Built"}</th>
                  <th className="!text-right">{es ? "Millas" : "Miles"}</th>
                </tr>
              </thead>
              <tbody>
                {p.comps.map((c) => {
                  const on = !excluded.has(c.folio);
                  return (
                    <tr key={c.folio} style={{ opacity: on ? 1 : 0.45, transition: "opacity .2s" }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Use ${c.address}`}
                          onChange={() =>
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.folio)) next.delete(c.folio);
                              else next.add(c.folio);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        <a className="text-accent font-medium" href={`/property/${c.folio}`}>
                          {c.address}
                          {c.unit ? ` #${c.unit}` : ""}
                        </a>
                      </td>
                      <td className="num">{fmtDate(c.saleDate)}</td>
                      <td className="num text-right">{fmtMoney(c.price)}</td>
                      <td className="num text-right">{c.heatedSqft?.toLocaleString("en-US") ?? "—"}</td>
                      <td className="num text-right">{c.heatedSqft ? fmtMoney(c.price / c.heatedSqft) : "—"}</td>
                      <td className="num text-right">
                        {c.beds ?? "—"}/{c.baths ?? "—"}
                      </td>
                      <td className="num text-right">{c.yearBuilt ?? "—"}</td>
                      <td className="num text-right">{c.distanceMiles?.toFixed(2) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* ---------- Inputs ---------- */}
      <section className="card no-print">
        <div className="h-eyebrow">{t(p.lang, "report.numbers")}</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumField
            label={es ? "ARV (valor después de reparar)" : "ARV (after-repair value)"}
            prefix="$"
            value={arvOverride ?? value?.likely ?? null}
            onChange={setArvOverride}
            hint={arvOverride === null ? (es ? "Prellenado con el estimado de arriba. Cámbielo por su ARV real." : "Prefilled with the estimate above. Replace with your real ARV.") : es ? "Su número." : "Your number."}
          />
          <div>
            <NumField label={es ? "Precio de compra" : "Purchase price"} prefix="$" value={purchase} onChange={setPurchase} placeholder={es ? "Escriba un precio" : "Enter a price"} />
            {w ? (
              <button type="button" className="text-accent mt-1 text-xs font-semibold" onClick={() => setPurchase(Math.round(w.target))}>
                {es ? "Usar oferta objetivo" : "Use target offer"} ({fmtMoney(w.target)})
              </button>
            ) : null}
          </div>
          <div>
            <span className="label">{es ? "Reparaciones" : "Repairs"}</span>
            <select className="input" value={repairLevel} onChange={(e) => setRepairLevel(e.target.value as RepairLevel | "custom")}>
              <option value="light">{es ? "Ligeras" : "Light"} (${a.repairLight}/sq ft)</option>
              <option value="medium">{es ? "Medias" : "Medium"} (${a.repairMedium}/sq ft)</option>
              <option value="heavy">{es ? "Fuertes" : "Heavy"} (${a.repairHeavy}/sq ft)</option>
              <option value="custom">{es ? "Monto propio" : "My own amount"}</option>
            </select>
            {repairLevel === "custom" ? (
              <div className="mt-2">
                <NumField label="" prefix="$" value={repairCustom} onChange={setRepairCustom} placeholder="0" />
              </div>
            ) : (
              <span className="muted mt-1 block text-[11.5px]">
                {repairs !== null ? `${fmtMoney(repairs)} = ${p.heatedSqft?.toLocaleString("en-US")} sq ft × $/sq ft` : es ? "Área desconocida: use monto propio." : "Square footage unknown: use your own amount."}
              </span>
            )}
          </div>
          <NumField label={es ? "Renta mensual" : "Monthly rent"} prefix="$" value={rent} onChange={setRent} hint={es ? "Sin fuente de rentas conectada. Escriba la renta de mercado." : "No rent data source connected. Enter market rent."} />
          <NumField label={es ? "Seguro anual" : "Insurance per year"} prefix="$" value={insurance} onChange={setInsurance} hint={es ? "Use una cotización real (viento + inundación)." : "Use a real quote (wind + flood)."} />
          <NumField label={es ? "HOA / condominio al mes" : "HOA / condo fee per month"} prefix="$" value={hoa} onChange={setHoa} />
        </div>

        <details className="mt-4">
          <summary className="text-accent cursor-pointer text-sm font-semibold">
            {es ? "Supuestos (cámbielos por sus números)" : "Assumptions (replace with your numbers)"}
          </summary>
          <p className="muted mt-2 text-sm">
            {es
              ? "El 70% y los $25/$45/$70 por pie² vienen de su plan. El resto son valores de partida, no datos: ajústelos."
              : "The 70% and the $25/$45/$70 per sq ft come from your build brief. The rest are starting placeholders, not data: set your own."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <NumField label="MAO %" suffix="%" value={pctField(a.maoPct)} onChange={setPct("maoPct")} />
            <NumField label={es ? "Cuota de cesión" : "Assignment fee"} prefix="$" value={a.assignmentFee} onChange={setNum("assignmentFee")} />
            <NumField label={es ? "Rep. ligeras $/pie²" : "Light repairs $/sq ft"} prefix="$" value={a.repairLight} onChange={setNum("repairLight")} />
            <NumField label={es ? "Rep. medias $/pie²" : "Medium repairs $/sq ft"} prefix="$" value={a.repairMedium} onChange={setNum("repairMedium")} />
            <NumField label={es ? "Rep. fuertes $/pie²" : "Heavy repairs $/sq ft"} prefix="$" value={a.repairHeavy} onChange={setNum("repairHeavy")} />
            <NumField label={es ? "Meses de tenencia" : "Holding months"} value={a.holdingMonths} onChange={setNum("holdingMonths")} />
            <NumField label={es ? "Cierre al comprar" : "Buy closing costs"} suffix="%" value={pctField(a.buyClosingPct)} onChange={setPct("buyClosingPct")} />
            <NumField label={es ? "Cierre al vender" : "Sell closing costs"} suffix="%" value={pctField(a.sellClosingPct)} onChange={setPct("sellClosingPct")} />
            <NumField label={es ? "Comisiones al vender" : "Sale commissions"} suffix="%" value={pctField(a.commissionPct)} onChange={setPct("commissionPct")} />
            <NumField label={es ? "Préstamo duro: % financiado" : "Hard money: % financed"} suffix="%" value={pctField(a.hardMoneyLtc)} onChange={setPct("hardMoneyLtc")} />
            <NumField label={es ? "Préstamo duro: tasa" : "Hard money: rate"} suffix="%" value={pctField(a.hardMoneyRate)} onChange={setPct("hardMoneyRate")} />
            <NumField label={es ? "Préstamo duro: puntos" : "Hard money: points"} suffix="%" value={pctField(a.hardMoneyPoints)} onChange={setPct("hardMoneyPoints")} />
            <NumField label={es ? "Hipoteca: tasa" : "Long-term loan rate"} suffix="%" value={pctField(a.loanRate)} onChange={setPct("loanRate")} />
            <NumField label={es ? "Pago inicial" : "Down payment"} suffix="%" value={pctField(a.downPct)} onChange={setPct("downPct")} />
            <NumField label={es ? "Refinanciamiento LTV" : "Refinance LTV"} suffix="%" value={pctField(a.refiLtv)} onChange={setPct("refiLtv")} />
            <NumField label={es ? "Vacancia" : "Vacancy"} suffix="%" value={pctField(a.vacancyPct)} onChange={setPct("vacancyPct")} />
            <NumField label={es ? "Mantenimiento" : "Maintenance"} suffix="%" value={pctField(a.maintenancePct)} onChange={setPct("maintenancePct")} />
            <NumField label={es ? "Administración" : "Management"} suffix="%" value={pctField(a.managementPct)} onChange={setPct("managementPct")} />
            <NumField label={es ? "Impuesto tras la venta" : "Post-sale tax rate"} suffix="%/yr" value={pctField(a.taxRate)} onChange={setPct("taxRate")} />
            <NumField label={es ? "Servicios al mes (obra)" : "Utilities per month (flip)"} prefix="$" value={a.holdingUtilitiesMonthly} onChange={setNum("holdingUtilitiesMonthly")} />
          </div>
        </details>
      </section>

      {/* ---------- Verdict ---------- */}
      <section className="card">
        <div className="flex flex-wrap items-center gap-5">
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl text-4xl font-bold"
            style={{
              background: gradeTone ? `color-mix(in srgb, var(--${gradeTone}) 15%, transparent)` : "var(--accent-soft)",
              color: gradeTone ? `var(--${gradeTone})` : "var(--muted)",
            }}
            aria-label={grade ? `Deal grade ${grade.grade}` : "Deal grade not available"}
          >
            {grade ? grade.grade : "–"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="h-eyebrow">{es ? "Calificación del negocio" : "Deal grade"}</div>
            {grade ? (
              <>
                <div className="mt-1 text-lg font-semibold">
                  {es ? "Precio + reparaciones =" : "Price + repairs ="} {fmtPct(grade.ratio, 0)} {es ? "del ARV" : "of ARV"}
                  {lowConfidence ? <span className="pill pill-warn ml-2">{es ? "bajó una letra: valor poco confiable" : "dropped one letter: shaky value"}</span> : null}
                </div>
                <p className="mt-1 text-[15px]">{verdict}</p>
                <p className="muted mt-1 text-xs">
                  {es ? "Regla: A ≤ 70%, B ≤ 75%, C ≤ 80%, D ≤ 88%, F más. Recomendación basada en reglas, no en IA." : "Rule: A ≤ 70%, B ≤ 75%, C ≤ 80%, D ≤ 88%, F above. Recommendation is rule-based, not AI."}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[15px]">{es ? "Escriba un precio de compra para calificar el negocio." : "Enter a purchase price to grade the deal."}</p>
            )}
          </div>
        </div>
        {missing.length ? (
          <div className="card-flat mt-4 text-sm">
            <strong>{es ? "Falta para completar el análisis:" : "Still needed for a full analysis:"}</strong> {missing.join(" · ")}
          </div>
        ) : null}
      </section>

      {/* ---------- Strategies ---------- */}
      <div className="h-eyebrow -mb-2 px-1">{t(p.lang, "report.strategies")}</div>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="card">
          <div className="text-lg font-semibold">{es ? "Mayoreo (wholesale)" : "Wholesale"}</div>
          {w ? (
            <div className="mt-2">
              <Row label={`ARV × ${fmtPct(a.maoPct, 0)}`} value={fmtMoney((arv as number) * a.maoPct)} />
              <Row label={es ? "− Reparaciones" : "− Repairs"} value={fmtMoney(repairs)} />
              <Row label={es ? "Máximo del comprador final" : "End buyer's max"} value={fmtMoney(w.buyerMax)} />
              <Row label={es ? "− Mi cuota de cesión" : "− My assignment fee"} value={fmtMoney(a.assignmentFee)} />
              <Row total label={es ? "Mi oferta máxima (MAO)" : "My max offer (MAO)"} value={fmtMoney(w.mao)} tone={w.mao > 0 ? undefined : "bad"} />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[
                  [es ? "Apertura" : "Opening", w.opening],
                  [es ? "Objetivo" : "Target", w.target],
                  [es ? "Tope" : "Walk-away", w.walkAway],
                ].map(([label, v]) => (
                  <div key={label as string} className="card-flat !px-2 !py-2">
                    <div className="muted text-[11px] font-semibold uppercase tracking-wide">{label}</div>
                    <div className="num text-[15px] font-bold">{fmtMoney(v as number)}</div>
                  </div>
                ))}
              </div>
              {purchase !== null ? (
                <Row label={es ? "Margen a su precio" : "Spread at your price"} value={fmtMoney(w.buyerMax - purchase)} tone={w.buyerMax - purchase >= a.assignmentFee ? "good" : "bad"} />
              ) : null}
            </div>
          ) : (
            <p className="muted mt-2 text-sm">{es ? "Necesita ARV y reparaciones." : "Needs ARV and repairs."}</p>
          )}
        </div>

        <div className="card">
          <div className="text-lg font-semibold">{es ? "Remodelar y vender" : "Fix & flip"}</div>
          {f ? (
            <div className="mt-2">
              <Row label={es ? "Venta (ARV)" : "Sale (ARV)"} value={fmtMoney(arv)} />
              <Row label={es ? "Compra" : "Purchase"} value={fmtMoney(purchase)} />
              <Row label={es ? "Reparaciones" : "Repairs"} value={fmtMoney(repairs)} />
              <Row label={es ? "Cierre de compra" : "Buy closing"} value={fmtMoney(f.buyClosing)} />
              <Row label={es ? `Préstamo: puntos + ${a.holdingMonths} meses de interés` : `Loan: points + ${a.holdingMonths} mo interest`} value={fmtMoney(f.points + f.interest)} />
              <Row label={es ? "Impuestos, seguro, servicios" : "Taxes, insurance, utilities"} value={fmtMoney(f.holdingTaxes + f.holdingInsurance + f.holdingUtilities)} />
              <Row label={es ? "Comisiones + cierre de venta" : "Commissions + sell closing"} value={fmtMoney(f.commission + f.sellClosing)} />
              <Row label={es ? "Sellos documentales" : "Doc stamps on deed"} value={fmtMoney(f.docStamps)} />
              <Row total label={es ? "Ganancia" : "Profit"} value={fmtMoney(f.profit)} tone={f.profit > 0 ? "good" : "bad"} />
              <Row label={es ? "Efectivo invertido" : "Cash invested"} value={fmtMoney(f.cashInvested)} />
              <Row label="ROI" value={`${fmtPct(f.roi)} · ${fmtPct(f.annualizedRoi)} ${es ? "anualizado" : "annualized"}`} />
              {insurance === null ? <p className="text-warn mt-2 text-xs">{es ? "Sin seguro: la ganancia real será menor." : "No insurance entered: real profit will be lower."}</p> : null}
            </div>
          ) : (
            <p className="muted mt-2 text-sm">{es ? "Necesita ARV, reparaciones y precio de compra." : "Needs ARV, repairs and a purchase price."}</p>
          )}
        </div>

        <div className="card">
          <div className="text-lg font-semibold">BRRRR</div>
          {b ? (
            <div className="mt-2">
              <Row label={es ? "Costo total (con financiamiento)" : "All-in cost (with carry)"} value={fmtMoney(b.allIn)} />
              <Row label={es ? "Costo total ÷ ARV" : "All-in ÷ ARV"} value={fmtPct(b.allInToArv, 0)} tone={(b.allInToArv ?? 1) <= a.refiLtv ? "good" : "warn"} />
              <Row label={`${es ? "Refinanciamiento al" : "Refinance at"} ${fmtPct(a.refiLtv, 0)}`} value={fmtMoney(b.refiLoan)} />
              <Row total label={es ? "Efectivo que queda adentro" : "Cash left in the deal"} value={fmtMoney(b.cashLeftIn)} tone={b.cashLeftIn <= 0 ? "good" : undefined} />
              <Row label={es ? "Flujo mensual tras refinanciar" : "Cash flow after refi"} value={`${fmtMoney(b.cashFlowMonthly)}/mo`} tone={b.cashFlowMonthly > 0 ? "good" : "bad"} />
              <Row label="DSCR" value={b.dscr === null ? "Unknown" : b.dscr.toFixed(2)} tone={(b.dscr ?? 0) >= 1.2 ? "good" : "warn"} />
              <p className="muted mt-2 text-xs">{es ? "Impuestos tras refinanciar calculados sobre el ARV." : "Taxes after the refi are figured on ARV."}</p>
            </div>
          ) : (
            <p className="muted mt-2 text-sm">{es ? "Necesita ARV, reparaciones, precio y renta." : "Needs ARV, repairs, a purchase price and rent."}</p>
          )}
        </div>

        <div className="card">
          <div className="text-lg font-semibold">{es ? "Comprar y rentar" : "Buy & hold"}</div>
          {r ? (
            <div className="mt-2">
              <Row label={es ? "Renta anual" : "Rent per year"} value={fmtMoney(r.grossRentAnnual)} />
              <Row label={es ? "Vacancia" : "Vacancy"} value={fmtMoney(-r.vacancy)} />
              <Row label={es ? "Impuestos (tras la venta, estimado)" : "Taxes (post-sale estimate)"} value={fmtMoney(-r.taxes)} />
              <Row label={es ? "Seguro" : "Insurance"} value={insurance === null ? "Unknown" : fmtMoney(-r.insurance)} tone={insurance === null ? "warn" : undefined} />
              <Row label={es ? "Mantenimiento + administración" : "Maintenance + management"} value={fmtMoney(-(r.maintenance + r.management))} />
              {r.hoa ? <Row label="HOA" value={fmtMoney(-r.hoa)} /> : null}
              <Row label="NOI" value={fmtMoney(r.noi)} />
              <Row label={es ? "Hipoteca al año" : "Mortgage per year"} value={fmtMoney(-r.debtServiceAnnual)} />
              <Row total label={es ? "Flujo de efectivo" : "Cash flow"} value={`${fmtMoney(r.cashFlowMonthly)}/mo`} tone={r.cashFlowMonthly > 0 ? "good" : "bad"} />
              <Row label={es ? "Tasa de capitalización" : "Cap rate"} value={fmtPct(r.capRate)} />
              <Row label={es ? "Retorno sobre efectivo" : "Cash-on-cash"} value={fmtPct(r.cashOnCash)} />
              <Row label="DSCR" value={r.dscr === null ? "Unknown" : r.dscr.toFixed(2)} />
              <Row label={es ? "Regla del 1%" : "1% rule"} value={fmtPct(r.onePercentRule, 2)} tone={(r.onePercentRule ?? 0) >= 0.01 ? "good" : "warn"} />
              {r.pricePerDoor !== null && (p.units ?? 1) > 1 ? <Row label={es ? "Precio por puerta" : "Price per door"} value={fmtMoney(r.pricePerDoor)} /> : null}
              {r.grm !== null ? <Row label="GRM" value={r.grm.toFixed(1)} /> : null}
            </div>
          ) : (
            <p className="muted mt-2 text-sm">{es ? "Necesita precio de compra y renta mensual." : "Needs a purchase price and monthly rent."}</p>
          )}
        </div>

        <div className="card">
          <div className="text-lg font-semibold">{es ? "Financiamiento creativo" : "Creative finance"}</div>
          <p className="muted mt-1 text-sm">
            {es
              ? "Hipotecas y saldo del préstamo: Desconocido (no hay registros de hipotecas conectados). Pregunte al vendedor."
              : "Mortgages and loan balance: Unknown (no recorded-mortgage data connected). Ask the seller."}
          </p>
          <div className="mt-3 text-sm font-semibold">{es ? "Financiamiento del vendedor" : "Seller finance"}</div>
          <div className="no-print mt-1 grid grid-cols-3 gap-2">
            <NumField label={es ? "Inicial" : "Down"} suffix="%" value={sfDown} onChange={setSfDown} />
            <NumField label={es ? "Tasa" : "Rate"} suffix="%" value={sfRate} onChange={setSfRate} />
            <NumField label={es ? "Años" : "Years"} value={sfYears} onChange={setSfYears} />
          </div>
          {sf ? (
            <>
              <Row label={es ? "Monto financiado" : "Amount financed"} value={fmtMoney(sf.financed)} />
              <Row label={es ? "Pago mensual" : "Monthly payment"} value={fmtMoney(sf.monthly)} />
              {rent !== null ? <Row label={es ? "Renta − pago" : "Rent − payment"} value={`${fmtMoney(rent - sf.monthly)}/mo`} tone={rent - sf.monthly > 0 ? "good" : "bad"} /> : null}
            </>
          ) : (
            <p className="muted text-sm">{es ? "Escriba un precio de compra." : "Enter a purchase price."}</p>
          )}
          <div className="mt-3 text-sm font-semibold">{es ? "Sujeto a la hipoteca existente" : "Subject-to"}</div>
          <div className="no-print mt-1 grid grid-cols-3 gap-2">
            <NumField label={es ? "Saldo" : "Loan balance"} prefix="$" value={stBalance} onChange={setStBalance} />
            <NumField label={es ? "Pago/mes" : "Payment/mo"} prefix="$" value={stPayment} onChange={setStPayment} />
            <NumField label={es ? "Efectivo al vendedor" : "Cash to seller"} prefix="$" value={stCash} onChange={setStCash} />
          </div>
          {st ? (
            <>
              <Row label={es ? "Costo de entrada" : "Entry cost"} value={fmtMoney(st.entryCost)} />
              <Row label={es ? "Margen mensual" : "Monthly spread"} value={st.monthlySpread === null ? (es ? "Falta la renta" : "Needs rent") : `${fmtMoney(st.monthlySpread)}/mo`} />
            </>
          ) : null}
          <p className="muted mt-2 text-xs">
            {es
              ? "Sujeto-a conviene con préstamo de tasa baja y poco capital; financiamiento del vendedor, con casa pagada. Todo préstamo tiene cláusula de vencimiento por venta: use a su abogado."
              : "Subject-to fits a low-rate loan with little equity; seller finance fits a free-and-clear owner. Every loan has a due-on-sale clause: use your attorney."}
          </p>
        </div>

        <div className="card">
          <div className="text-lg font-semibold">{es ? "Tomarla como listado" : "Take it as a listing"}</div>
          <p className="muted mt-1 text-sm">
            {es ? "Si al dueño le conviene vender al público, su papel es de agente, no de comprador." : "If the owner is better off selling retail, you wear the agent hat, not the buyer hat."}
          </p>
          <div className="no-print mt-2 grid grid-cols-2 gap-2">
            <NumField label={es ? "Comisión del lado del listado" : "Listing-side commission"} suffix="%" value={listPct} onChange={setListPct} />
            <NumField label={es ? "Mi parte con el bróker" : "My split with broker"} suffix="%" value={split} onChange={setSplit} placeholder={es ? "Su parte" : "Your split"} />
          </div>
          <Row label={es ? "Precio de lista estimado" : "Estimated list price"} value={fmtMoney(arv)} />
          <Row total label={es ? "Mi comisión" : "My commission"} value={commission === null ? (es ? "Escriba su parte" : "Enter your split") : fmtMoney(commission)} tone={commission ? "good" : undefined} />
        </div>
      </section>
    </div>
  );
}
