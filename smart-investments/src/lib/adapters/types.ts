// Plug-in data adapters. One interface per data type; each county or vendor
// implements the ones it can serve. Paid adapters are switched on by adding
// their API key — no other code changes.

import type { Sourced } from "@/lib/sourced";

/** "miami-dade" (own weekly source) or "fl-<DOR county number>" for every other Florida county. */
export type County = string;

export type PropertyType =
  | "single_family"
  | "condo"
  | "townhouse"
  | "duplex"
  | "multifamily_small"
  | "multifamily_large"
  | "coop"
  | "vacant_land"
  | "other";

export interface PropertyRecord {
  county: County;
  countyName: string;
  /** Route id. Miami-Dade: the 13-digit folio. Elsewhere: "fl-<county number>-<parcel id>". */
  folio: string;
  /** The parcel number as the county writes it. */
  parcelId: string;
  address: Sourced<string>;
  unit: Sourced<string>;
  city: Sourced<string>;
  zip: Sourced<string>;
  lat: number | null;
  lng: number | null;
  owners: Sourced<string[]>;
  mailingAddress: Sourced<string>;
  mailingCity: Sourced<string>;
  mailingState: Sourced<string>;
  mailingZip: Sourced<string>;
  mailingCountry: Sourced<string>;
  useCode: Sourced<string>;
  useDescription: Sourced<string>;
  propertyType: PropertyType;
  beds: Sourced<number>;
  baths: Sourced<number>;
  halfBaths: Sourced<number>;
  floors: Sourced<number>;
  units: Sourced<number>;
  heatedSqft: Sourced<number>;
  totalSqft: Sourced<number>;
  lotSqft: Sourced<number>;
  yearBuilt: Sourced<number>;
  assessedValue: Sourced<number>;
  /** The appraiser's market ("just") value. Only on the state roll. */
  justValue: Sourced<number>;
  assessmentYear: Sourced<number>;
  homestead: Sourced<boolean>;
  /** Last recorded deed transfer. Includes $0/$100 family or entity transfers, so it is not always a market sale. */
  lastTransferDate: Sourced<string>;
  lastTransferPrice: Sourced<number>;
  /** State sale-qualification result when the source has one; null means use the price test. */
  lastTransferQualified: boolean | null;
  /** True when the source only reports recent sales, so "no sale on record" does not mean long ownership. */
  olderTransfersUnknown: boolean;
}

export interface SaleComp {
  folio: string;
  address: string;
  unit: string | null;
  saleDate: string; // ISO date
  price: number;
  heatedSqft: number | null;
  lotSqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  distanceMiles: number | null;
  /** True when the source itself marks the sale as arm's-length. */
  qualified?: boolean | null;
}

export type DistressType =
  | "code_violation"
  | "code_violation_lien"
  | "foreclosure_registry"
  | "building_violation"
  | "unsafe_structure"
  | "expired_permit";

export interface DistressSignal {
  type: DistressType;
  folio: string;
  caseNumber: string;
  description: string;
  status: string;
  openedAt: string | null; // ISO date
  open: boolean;
  source: string;
  asOf: string | null;
  fetchedAt: string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  dataTypes: string[];
  tier: "free" | "lean" | "pro" | "plug-in";
  /** Cost per call in USD. 0 for free public sources. */
  costPerCall: number;
  enabled: boolean;
  /** Environment variable that switches a paid adapter on. */
  envKey?: string;
  coverage: string;
  /** Why it is off, or what it does not cover. */
  note: string;
}

export interface OwnershipAdapter {
  info: AdapterInfo;
  getByFolio(folio: string): Promise<PropertyRecord | null>;
  searchByAddress(
    streets: string[],
    opts: { mode: "exact" | "prefix"; zip?: string | null; unit?: string | null },
  ): Promise<PropertyRecord[]>;
  nearestToPoint(lat: number, lng: number, meters: number): Promise<PropertyRecord[]>;
  listByZip(
    zip: string,
    opts: { types?: PropertyType[]; max?: number },
  ): Promise<{ records: PropertyRecord[]; truncated: boolean; total: number }>;
}

export interface SalesQuery {
  lat: number;
  lng: number;
  radiusMiles: number;
  sinceIso: string;
  useCode: string;
  minSqft: number | null;
  maxSqft: number | null;
}

export interface SalesAdapter {
  info: AdapterInfo;
  recentSalesNear(q: SalesQuery): Promise<SaleComp[]>;
}

export interface Box {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface DistressAdapter {
  info: AdapterInfo;
  /** Whether this adapter's data covers the parcel at all (county code data is unincorporated-only). */
  covers(folio: string): boolean;
  getForFolio(folio: string): Promise<DistressSignal[]>;
  openSignalsInBox(box: Box): Promise<DistressSignal[]>;
}
