// Assembles everything the Deal Report and the Lead Finder need from the adapters.

import { floodZoneAt, type FloodZone } from "@/lib/adapters/fema";
import { distressFor, ownershipFor, salesFor } from "@/lib/adapters/registry";
import type { DistressSignal, PropertyRecord, PropertyType, SaleComp } from "@/lib/adapters/types";
import { parseQuery, streetCandidates } from "@/lib/address";
import { buildApproach, type Approach } from "@/lib/analysis/approach";
import {
  COMP_TIERS,
  estimateValue,
  MIN_COMPS,
  monthsAgoIso,
  SQFT_BAND,
  usableComps,
  type ValueEstimate,
} from "@/lib/analysis/comps";
import { floridaGotchas, type Gotcha } from "@/lib/analysis/florida";
import { analyzeOwner, type OwnerIntel } from "@/lib/analysis/owner";
import { motivationScore, type MotivationScore } from "@/lib/analysis/score";

const COUNTY = "miami-dade" as const;

export type LookupResult =
  | { kind: "empty" }
  | { kind: "none"; tried: string; geocoded: boolean }
  | { kind: "one"; folio: string }
  | { kind: "many"; matches: PropertyRecord[] };

/** Census Bureau geocoder: free, official, no key. Used only when the county address match fails. */
async function geocode(raw: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.searchParams.set("address", /\bFL\b|FLORIDA/i.test(raw) ? raw : `${raw}, FL`);
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { addressMatches?: { coordinates: { x: number; y: number } }[] };
    };
    const m = json.result?.addressMatches?.[0];
    return m ? { lat: m.coordinates.y, lng: m.coordinates.x } : null;
  } catch {
    return null;
  }
}

export async function lookup(input: string): Promise<LookupResult> {
  const q = parseQuery(input);
  if (q.kind === "empty") return { kind: "empty" };
  const ownership = ownershipFor(COUNTY)!;

  if (q.kind === "folio") {
    const rec = await ownership.getByFolio(q.folio);
    return rec ? { kind: "one", folio: rec.folio } : { kind: "none", tried: q.folio, geocoded: false };
  }

  const candidates = streetCandidates(q.tokens);
  const settle = (matches: PropertyRecord[]): LookupResult | null => {
    // When several candidate spellings matched, keep the longest (most specific) one.
    const best = candidates.find((c) => matches.some((m) => m.address.value === c));
    const list = best ? matches.filter((m) => m.address.value === best) : matches;
    if (list.length === 1) return { kind: "one", folio: list[0].folio };
    if (list.length > 1) return { kind: "many", matches: list };
    return null;
  };

  let exact = await ownership.searchByAddress(candidates, { mode: "exact", zip: q.zip, unit: q.unit });
  if (exact.length === 0 && q.unit) exact = await ownership.searchByAddress(candidates, { mode: "exact", zip: q.zip });
  const exactResult = settle(exact);
  if (exactResult) return exactResult;

  // Prefix search catches partial input such as "10236 W 32".
  const shortest = candidates[candidates.length - 1];
  const prefixResult = settle(await ownership.searchByAddress([shortest], { mode: "prefix", zip: q.zip }));
  if (prefixResult) return prefixResult;

  const point = await geocode(q.raw);
  if (point) {
    const near = await ownership.nearestToPoint(point.lat, point.lng, 60);
    const sameNumber = near.filter((n) => n.address.value?.split(" ")[0] === q.tokens[0]);
    const pick = sameNumber.length ? sameNumber : [];
    if (pick.length === 1) return { kind: "one", folio: pick[0].folio };
    if (pick.length > 1) return { kind: "many", matches: pick };
    return { kind: "none", tried: q.street, geocoded: true };
  }
  return { kind: "none", tried: q.street, geocoded: false };
}

export interface DealReport {
  property: PropertyRecord;
  owner: OwnerIntel;
  signals: DistressSignal[];
  violationsCovered: boolean;
  score: MotivationScore;
  comps: SaleComp[];
  compTierIndex: number | null;
  compTierLabel: string | null;
  compSource: string;
  value: ValueEstimate | null;
  flood: FloodZone | null;
  /** True when FEMA could not be reached (as opposed to answering "no mapped zone"). */
  floodLookupFailed: boolean;
  gotchas: Gotcha[];
  approach: Approach;
  generatedAt: string;
  elapsedMs: number;
}

async function findComps(p: PropertyRecord): Promise<{ comps: SaleComp[]; tierIndex: number | null }> {
  const sales = salesFor(COUNTY)!;
  if (p.lat === null || p.lng === null || !p.useCode.value || p.propertyType === "other") {
    return { comps: [], tierIndex: null };
  }
  const sqft = p.heatedSqft.value;
  let best: { comps: SaleComp[]; tierIndex: number | null } = { comps: [], tierIndex: null };
  for (let i = 0; i < COMP_TIERS.length; i++) {
    const tier = COMP_TIERS[i];
    const raw = await sales.recentSalesNear({
      lat: p.lat,
      lng: p.lng,
      radiusMiles: tier.radiusMiles,
      sinceIso: monthsAgoIso(tier.months),
      useCode: p.useCode.value,
      minSqft: sqft ? sqft * (1 - SQFT_BAND) : null,
      maxSqft: sqft ? sqft * (1 + SQFT_BAND) : null,
    });
    const comps = usableComps(p.folio, raw).slice(0, 15);
    if (comps.length > best.comps.length) best = { comps, tierIndex: i };
    if (comps.length >= MIN_COMPS) break;
  }
  return best;
}

export async function buildReport(folio: string): Promise<DealReport | null> {
  const started = Date.now();
  const ownership = ownershipFor(COUNTY)!;
  const distress = distressFor(COUNTY)!;

  const property = await ownership.getByFolio(folio);
  if (!property) return null;

  const violationsCovered = distress.covers(folio);
  let floodLookupFailed = false;
  const [signals, compResult, flood] = await Promise.all([
    violationsCovered ? distress.getForFolio(folio) : Promise.resolve([] as DistressSignal[]),
    findComps(property),
    property.lat !== null && property.lng !== null
      ? floodZoneAt(property.lat, property.lng).catch(() => {
          floodLookupFailed = true;
          return null;
        })
      : Promise.resolve(null),
  ]);

  const owner = analyzeOwner(property);
  const score = motivationScore({ owner, signals, violationsCovered });
  const value =
    compResult.tierIndex === null
      ? null
      : estimateValue(
          { heatedSqft: property.heatedSqft.value, lotSqft: property.lotSqft.value },
          compResult.comps,
          compResult.tierIndex,
        );

  const gotchas = floridaGotchas({
    type: property.propertyType,
    yearBuilt: property.yearBuilt.value,
    floors: property.floors.value,
    assessedValue: property.assessedValue.value,
    violationsCovered,
    openViolationCount: signals.filter((s) => s.open).length,
    city: property.city.value,
    flood,
  });

  const fullAddress = [property.address.value, property.unit.value ? `#${property.unit.value}` : null]
    .filter(Boolean)
    .join(" ");

  return {
    property,
    owner,
    signals,
    violationsCovered,
    score,
    comps: compResult.comps,
    compTierIndex: compResult.tierIndex,
    compTierLabel: compResult.tierIndex === null ? null : COMP_TIERS[compResult.tierIndex].label,
    compSource: salesFor(COUNTY)!.info.name,
    value,
    flood,
    floodLookupFailed,
    gotchas,
    approach: buildApproach({ address: fullAddress || "the property", owner, signals }),
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
  };
}

// ---------- Lead Finder ----------

export interface Lead {
  folio: string;
  address: string;
  unit: string | null;
  city: string | null;
  owner: string | null;
  ownerKind: OwnerIntel["kind"];
  type: PropertyType;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  yearsSinceTransfer: number | null;
  score: number;
  reasons: { label: string; points: number }[];
}

export interface LeadSearch {
  zip: string;
  types: PropertyType[];
  minScore: number;
  absenteeOnly: boolean;
  limit: number;
}

export interface LeadResult {
  leads: Lead[];
  scanned: number;
  totalInZip: number;
  truncated: boolean;
  matched: number;
  violationsCoveredCount: number;
  dataAsOf: string | null;
  elapsedMs: number;
}

export async function findLeads(search: LeadSearch): Promise<LeadResult> {
  const started = Date.now();
  const ownership = ownershipFor(COUNTY)!;
  const distress = distressFor(COUNTY)!;

  const { records, truncated, total } = await ownership.listByZip(search.zip, { types: search.types, max: 30_000 });

  const covered = records.filter((r) => distress.covers(r.folio) && r.lat !== null && r.lng !== null);
  const byFolio = new Map<string, DistressSignal[]>();
  if (covered.length > 0) {
    const lats = covered.map((r) => r.lat as number);
    const lngs = covered.map((r) => r.lng as number);
    const signals = await distress.openSignalsInBox({
      minLat: Math.min(...lats) - 0.001,
      maxLat: Math.max(...lats) + 0.001,
      minLng: Math.min(...lngs) - 0.001,
      maxLng: Math.max(...lngs) + 0.001,
    });
    for (const s of signals) {
      const list = byFolio.get(s.folio);
      if (list) list.push(s);
      else byFolio.set(s.folio, [s]);
    }
  }

  const today = new Date();
  const leads: Lead[] = [];
  for (const r of records) {
    const owner = analyzeOwner(r, today);
    if (owner.kind === "government") continue;
    if (search.absenteeOnly && !owner.absentee) continue;
    const violationsCovered = distress.covers(r.folio);
    const score = motivationScore({ owner, signals: byFolio.get(r.folio) ?? [], violationsCovered });
    if (score.score < search.minScore || score.score === 0) continue;
    leads.push({
      folio: r.folio,
      address: r.address.value ?? "Unknown",
      unit: r.unit.value,
      city: r.city.value,
      owner: r.owners.value?.[0] ?? null,
      ownerKind: owner.kind,
      type: r.propertyType,
      beds: r.beds.value,
      baths: r.baths.value,
      sqft: r.heatedSqft.value,
      yearBuilt: r.yearBuilt.value,
      yearsSinceTransfer: owner.yearsSinceTransfer,
      score: score.score,
      reasons: score.reasons,
    });
  }
  leads.sort((a, b) => b.score - a.score || (b.yearsSinceTransfer ?? 0) - (a.yearsSinceTransfer ?? 0));

  return {
    leads: leads.slice(0, search.limit),
    scanned: records.length,
    totalInZip: total,
    truncated,
    matched: leads.length,
    violationsCoveredCount: covered.length,
    dataAsOf: records[0]?.address.asOf ?? null,
    elapsedMs: Date.now() - started,
  };
}
