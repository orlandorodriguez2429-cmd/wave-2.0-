// Zip-level market stats and cash-buyer discovery, computed from county parcel records.
//
// Important limit: the free county layer holds only each parcel's MOST RECENT deed
// transfer. So "sales in the last 12 months" is exact for parcels that sold once, but a
// house bought and resold inside the window appears only as its latest sale. Flippers
// who already sold are therefore undercounted, and older periods cannot be rebuilt.

import type { PropertyRecord, PropertyType } from "@/lib/adapters/types";
import { percentile } from "@/lib/analysis/comps";
import { analyzeOwner, classifyOwner, type OwnerKind } from "@/lib/analysis/owner";

export const RESIDENTIAL_TYPES: PropertyType[] = [
  "single_family",
  "condo",
  "townhouse",
  "duplex",
  "multifamily_small",
  "multifamily_large",
];

/** Same test the comps use: real money, and not far below assessed value. */
export function recordIsMarketSale(r: PropertyRecord): boolean {
  const price = r.lastTransferPrice.value;
  if (price === null || price < 10_000) return false;
  if (r.lastTransferQualified !== null) return r.lastTransferQualified;
  const assessed = r.assessedValue.value;
  if (assessed !== null && price < 0.5 * assessed) return false;
  return true;
}

function daysAgo(iso: string, today: Date): number {
  return (today.getTime() - new Date(iso).getTime()) / 86_400_000;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  return percentile([...values].sort((a, b) => a - b), 0.5);
}

export interface TypeStats {
  type: PropertyType;
  parcels: number;
  sales12m: number;
  medianPrice: number | null;
  medianPerSqft: number | null;
  /** Median $/sq ft, most recent 6 months vs the 6 months before. null when either half has under 5 sales. */
  recent6PerSqft: number | null;
  prior6PerSqft: number | null;
  trend: number | null;
  /** Share of parcels that sold in the last 12 months. */
  turnover: number | null;
}

export interface MarketStats {
  parcels: number;
  sales12m: number;
  byType: TypeStats[];
  /** Share of last-12-month purchases where the buyer is a company or the mailing address differs from the property. */
  investorShare: number | null;
  companyShare: number | null;
  absenteeShare: number | null;
  outOfStateShare: number | null;
  longOwnershipShare: number | null;
}

const MIN_HALF = 5;

export function marketStats(records: PropertyRecord[], today: Date = new Date()): MarketStats {
  const sold = records.filter(
    (r) => r.lastTransferDate.value && daysAgo(r.lastTransferDate.value, today) <= 365 && recordIsMarketSale(r),
  );

  const byType: TypeStats[] = [];
  for (const type of RESIDENTIAL_TYPES) {
    const parcels = records.filter((r) => r.propertyType === type);
    if (parcels.length === 0) continue;
    const s = sold.filter((r) => r.propertyType === type);
    const ppsf = (list: PropertyRecord[]) =>
      list
        .filter((r) => r.heatedSqft.value)
        .map((r) => (r.lastTransferPrice.value as number) / (r.heatedSqft.value as number));
    const recent = s.filter((r) => daysAgo(r.lastTransferDate.value as string, today) <= 182);
    const prior = s.filter((r) => daysAgo(r.lastTransferDate.value as string, today) > 182);
    const recentPpsf = ppsf(recent);
    const priorPpsf = ppsf(prior);
    const r6 = recentPpsf.length >= MIN_HALF ? median(recentPpsf) : null;
    const p6 = priorPpsf.length >= MIN_HALF ? median(priorPpsf) : null;
    byType.push({
      type,
      parcels: parcels.length,
      sales12m: s.length,
      medianPrice: median(s.map((r) => r.lastTransferPrice.value as number)),
      medianPerSqft: median(ppsf(s)),
      recent6PerSqft: r6,
      prior6PerSqft: p6,
      trend: r6 !== null && p6 !== null && p6 > 0 ? r6 / p6 - 1 : null,
      turnover: s.length / parcels.length,
    });
  }

  const owners = records.map((r) => analyzeOwner(r, today)).filter((o) => o.kind !== "government");
  const share = (n: number, d: number) => (d > 0 ? n / d : null);
  const buyers = sold.map((r) => analyzeOwner(r, today));
  const known = (list: (boolean | null)[]) => list.filter((v) => v !== null) as boolean[];
  const absentee = known(owners.map((o) => o.absentee));
  const oos = known(owners.map((o) => o.outOfState));
  const withYears = owners.filter((o) => o.yearsSinceTransfer !== null);

  return {
    parcels: records.length,
    sales12m: sold.length,
    byType,
    investorShare: share(buyers.filter((o) => o.kind === "company" || o.absentee === true).length, buyers.length),
    companyShare: share(buyers.filter((o) => o.kind === "company").length, buyers.length),
    absenteeShare: share(absentee.filter(Boolean).length, absentee.length),
    outOfStateShare: share(oos.filter(Boolean).length, oos.length),
    longOwnershipShare: share(withYears.filter((o) => (o.yearsSinceTransfer as number) >= 15).length, withYears.length),
  };
}

// ---------- Buyers ----------

export interface BuyerPurchase {
  folio: string;
  address: string;
  type: PropertyType;
  date: string;
  price: number;
}

export interface Buyer {
  name: string;
  kind: OwnerKind;
  mailing: string | null;
  purchases: BuyerPurchase[];
  totalSpent: number;
  minPrice: number;
  maxPrice: number;
  types: PropertyType[];
  /** Every purchase has a mailing address different from the property (not moving in). */
  allAbsentee: boolean;
}

/**
 * Likely investor-buyers: anyone who bought in the window and is either a company or
 * bought two or more properties. Cash vs financed is NOT known (needs recorded mortgages).
 */
export function findBuyers(records: PropertyRecord[], today: Date = new Date(), windowDays = 365): Buyer[] {
  const groups = new Map<string, { name: string; records: PropertyRecord[] }>();
  for (const r of records) {
    const date = r.lastTransferDate.value;
    const name = r.owners.value?.[0];
    if (!date || !name || daysAgo(date, today) > windowDays || !recordIsMarketSale(r)) continue;
    const key = name.toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
    const g = groups.get(key);
    if (g) g.records.push(r);
    else groups.set(key, { name, records: [r] });
  }

  const buyers: Buyer[] = [];
  for (const g of groups.values()) {
    const kind = classifyOwner([g.name]);
    if (kind === "government") continue;
    if (kind !== "company" && g.records.length < 2) continue;
    const purchases = g.records
      .map((r) => ({
        folio: r.folio,
        address: [r.address.value ?? "Unknown", r.unit.value ? `#${r.unit.value}` : null].filter(Boolean).join(" "),
        type: r.propertyType,
        date: r.lastTransferDate.value as string,
        price: r.lastTransferPrice.value as number,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const prices = purchases.map((p) => p.price);
    const first = g.records[0];
    buyers.push({
      name: g.name,
      kind,
      mailing:
        [first.mailingAddress.value, first.mailingCity.value, first.mailingState.value, first.mailingZip.value]
          .filter(Boolean)
          .join(", ") || null,
      purchases,
      totalSpent: prices.reduce((a, b) => a + b, 0),
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      types: [...new Set(purchases.map((p) => p.type))],
      allAbsentee: g.records.every((r) => analyzeOwner(r, today).absentee === true),
    });
  }
  return buyers.sort((a, b) => b.purchases.length - a.purchases.length || b.totalSpent - a.totalSpent);
}
