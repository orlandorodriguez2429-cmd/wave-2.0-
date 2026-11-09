// Florida statewide adapter: every county's tax roll as collected by the Florida
// Department of Revenue and published by the Florida Geographic Information Office
// ("FDOR Cadastral Centroids 2026"). Used for every county except Miami-Dade, which has
// its own fresher weekly source.
//
// What it is: the yearly NAL roll. Owner, mailing address, values, homestead, building
// size and year, and up to two sales from roughly the last two years with the state's
// sale-qualification code. No beds/baths. Updated once a year, so ownership can be
// months out of date.
//
// Verified against the live service on 11/09/2026. Only PARCEL_ID, CO_NO, OWN_NAME and
// the geometry are indexed, so every search here goes through the parcel ID or a map box;
// filtering by address or zip text times out.

import { sourced, type Sourced } from "@/lib/sourced";
import { layerDataDate, queryLayer, sqlString, type Feature } from "./arcgis";
import type { AdapterInfo, OwnershipAdapter, PropertyRecord, PropertyType, SaleComp, SalesAdapter, SalesQuery } from "./types";

const LAYER =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Parcel_Centroid_Version/FeatureServer/0";
const ZIP_LAYER = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_ZIP_Code_Areas_anaylsis/FeatureServer/0";
const SOURCE = "Florida Dept. of Revenue 2026 tax roll (statewide parcels, FL Geographic Information Office)";
const ID = "fl-statewide-roll";

const FIELDS = [
  "CO_NO",
  "PARCEL_ID",
  "DOR_UC",
  "JV",
  "AV_SD",
  "AV_HMSTD",
  "ACT_YR_BLT",
  "TOT_LVG_AR",
  "NO_RES_UNT",
  "LND_SQFOOT",
  "QUAL_CD1",
  "SALE_PRC1",
  "SALE_YR1",
  "SALE_MO1",
  "OWN_NAME",
  "OWN_ADDR1",
  "OWN_ADDR2",
  "OWN_CITY",
  "OWN_STATE",
  "OWN_ZIPCD",
  "PHY_ADDR1",
  "PHY_ADDR2",
  "PHY_CITY",
  "PHY_ZIPCD",
  "ASMNT_YR",
];

/** Florida DOR county numbers (alphabetical, starting at 11). */
export const FL_COUNTIES: Record<number, string> = {
  11: "Alachua", 12: "Baker", 13: "Bay", 14: "Bradford", 15: "Brevard", 16: "Broward", 17: "Calhoun", 18: "Charlotte",
  19: "Citrus", 20: "Clay", 21: "Collier", 22: "Columbia", 23: "Miami-Dade", 24: "DeSoto", 25: "Dixie", 26: "Duval",
  27: "Escambia", 28: "Flagler", 29: "Franklin", 30: "Gadsden", 31: "Gilchrist", 32: "Glades", 33: "Gulf", 34: "Hamilton",
  35: "Hardee", 36: "Hendry", 37: "Hernando", 38: "Highlands", 39: "Hillsborough", 40: "Holmes", 41: "Indian River",
  42: "Jackson", 43: "Jefferson", 44: "Lafayette", 45: "Lake", 46: "Lee", 47: "Leon", 48: "Levy", 49: "Liberty",
  50: "Madison", 51: "Manatee", 52: "Marion", 53: "Martin", 54: "Monroe", 55: "Nassau", 56: "Okaloosa", 57: "Okeechobee",
  58: "Orange", 59: "Osceola", 60: "Palm Beach", 61: "Pasco", 62: "Pinellas", 63: "Polk", 64: "Putnam", 65: "St. Johns",
  66: "St. Lucie", 67: "Santa Rosa", 68: "Sarasota", 69: "Seminole", 70: "Sumter", 71: "Suwannee", 72: "Taylor",
  73: "Union", 74: "Volusia", 75: "Wakulla", 76: "Walton", 77: "Washington",
};

/** State DOR land-use codes (3 digits). Townhouses and duplexes are not separated at this level. */
const TYPE_CODES: Record<string, PropertyType> = {
  "000": "vacant_land",
  "001": "single_family",
  "003": "multifamily_large",
  "004": "condo",
  "005": "coop",
  "008": "multifamily_small",
};

export function statewideType(code: string | null): PropertyType {
  return (code && TYPE_CODES[code]) || "other";
}

function codesFor(types: PropertyType[]): string[] {
  const wanted = new Set(types);
  // The state roll files townhouses under single-family and duplexes under small multifamily.
  if (wanted.has("townhouse")) wanted.add("single_family");
  if (wanted.has("duplex")) wanted.add("multifamily_small");
  return Object.entries(TYPE_CODES)
    .filter(([, t]) => wanted.has(t))
    .map(([code]) => code);
}

/** Route id for a statewide parcel: "fl-<county number>-<parcel id>". */
export function statewideId(countyNo: number, parcelId: string): string {
  return `fl-${countyNo}-${parcelId}`;
}

export function parseStatewideId(id: string): { countyNo: number; parcelId: string } | null {
  const m = id.match(/^fl-(\d{1,2})-([A-Za-z0-9.\-]{4,30})$/);
  return m ? { countyNo: Number(m[1]), parcelId: m[2] } : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function posNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function zip5(v: unknown): string | null {
  const n = posNum(v);
  return n === null ? null : String(Math.trunc(n)).padStart(5, "0").slice(0, 5);
}
function saleDate(year: unknown, month: unknown): string | null {
  const y = posNum(year);
  if (y === null) return null;
  const m = Math.min(12, Math.max(1, Number(str(month)) || 1));
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
/** Codes 01 and 02 are the state's "qualified" arm's-length sales. */
function qualified(code: unknown): boolean | null {
  const c = str(code);
  return c === null ? null : c === "01" || c === "02";
}

function toRecord(f: Feature, asOf: string | null, fetchedAt: string): PropertyRecord {
  const a = f.attributes;
  const s = <T>(value: T | null, note?: string): Sourced<T> => sourced<T>(value, { source: SOURCE, asOf, fetchedAt, confidence: "high", note });
  const countyNo = Number(a.CO_NO);
  const parcelId = String(a.PARCEL_ID).trim();
  const useCode = str(a.DOR_UC);
  const state = str(a.OWN_STATE)?.toUpperCase() ?? null;
  const date = saleDate(a.SALE_YR1, a.SALE_MO1);
  const homesteadValue = typeof a.AV_HMSTD === "number" ? a.AV_HMSTD : null;
  return {
    county: `fl-${countyNo}`,
    countyName: FL_COUNTIES[countyNo] ?? `Florida county ${countyNo}`,
    folio: statewideId(countyNo, parcelId),
    parcelId,
    address: s(str(a.PHY_ADDR1)),
    unit: s(str(a.PHY_ADDR2)),
    city: s(str(a.PHY_CITY)),
    zip: s(zip5(a.PHY_ZIPCD)),
    lat: f.geometry?.y ?? null,
    lng: f.geometry?.x ?? null,
    owners: s(str(a.OWN_NAME) ? [str(a.OWN_NAME) as string] : null),
    mailingAddress: s([str(a.OWN_ADDR1), str(a.OWN_ADDR2)].filter(Boolean).join(" ") || null),
    mailingCity: s(str(a.OWN_CITY)),
    mailingState: s(state === "FLORIDA" ? "FL" : state),
    mailingZip: s(zip5(a.OWN_ZIPCD)),
    mailingCountry: s<string>(null),
    useCode: s(useCode),
    useDescription: s<string>(null),
    propertyType: statewideType(useCode),
    beds: s<number>(null, "The state tax roll does not include bedrooms."),
    baths: s<number>(null, "The state tax roll does not include bathrooms."),
    halfBaths: s<number>(null),
    floors: s<number>(null),
    units: s(posNum(a.NO_RES_UNT)),
    heatedSqft: s(posNum(a.TOT_LVG_AR)),
    totalSqft: s<number>(null),
    lotSqft: s(posNum(a.LND_SQFOOT)),
    yearBuilt: s(posNum(a.ACT_YR_BLT)),
    assessedValue: s(posNum(a.AV_SD)),
    justValue: s(posNum(a.JV), "The property appraiser's market value on the tax roll."),
    assessmentYear: s(posNum(a.ASMNT_YR)),
    homestead: s(homesteadValue === null ? null : homesteadValue > 0, "From the roll's homestead assessed value."),
    lastTransferDate: s(date, "The state roll gives the month and year only, and only for sales in about the last two years."),
    lastTransferPrice: s(date ? (typeof a.SALE_PRC1 === "number" ? a.SALE_PRC1 : null) : null),
    lastTransferQualified: date ? qualified(a.QUAL_CD1) : null,
    olderTransfersUnknown: true,
  };
}

/** A small map box around a point. The service rejects point-and-distance searches, so boxes are used instead. */
function boxAround(lat: number, lng: number, miles: number): string {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`;
}

function distMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

const info = (name: string, dataTypes: string[], note: string): AdapterInfo => ({
  id: ID,
  name,
  dataTypes,
  tier: "free",
  costPerCall: 0,
  enabled: true,
  coverage: "All 67 Florida counties (used for every county except Miami-Dade)",
  note,
});

/** Map extent of a zip code, from Esri's public zip-boundary layer. null when the zip is unknown. */
export async function zipExtent(zip: string): Promise<string | null> {
  const res = await queryLayer(ZIP_LAYER, {
    adapterId: ID,
    where: `ZIP_CODE = ${sqlString(zip)} AND STATE = 'FL'`,
    outFields: ["ZIP_CODE"],
    returnGeometry: true,
    returnExtentOnly: true,
    max: 1,
  });
  const e = res.extent;
  return e ? `${e.xmin},${e.ymin},${e.xmax},${e.ymax}` : null;
}

export const statewideOwnership: OwnershipAdapter = {
  info: info(
    "Florida statewide tax roll (Dept. of Revenue, 2026)",
    ["ownership", "values", "homestead", "recent sales"],
    "Yearly roll: ownership can be months old. No beds/baths, no sales older than about two years. Zip scans are slow (1–3 minutes the first time).",
  ),

  async getByFolio(id) {
    const parsed = parseStatewideId(id);
    if (!parsed) return null;
    const [asOf, res] = await Promise.all([
      layerDataDate(LAYER, ID),
      queryLayer(LAYER, {
        adapterId: ID,
        where: `PARCEL_ID = ${sqlString(parsed.parcelId)} AND CO_NO = ${parsed.countyNo}`,
        outFields: FIELDS,
        returnGeometry: true,
        max: 1,
      }),
    ]);
    const f = res.features[0];
    return f ? toRecord(f, asOf, new Date().toISOString()) : null;
  },

  /** By bare parcel number, any county (the address fields are not searchable on this service). */
  async searchByAddress(parcelIds) {
    if (parcelIds.length === 0) return [];
    const [asOf, res] = await Promise.all([
      layerDataDate(LAYER, ID),
      queryLayer(LAYER, {
        adapterId: ID,
        where: `PARCEL_ID IN (${parcelIds.map(sqlString).join(",")})`,
        outFields: FIELDS,
        returnGeometry: true,
        max: 10,
      }),
    ]);
    const fetchedAt = new Date().toISOString();
    return res.features.map((f) => toRecord(f, asOf, fetchedAt));
  },

  async nearestToPoint(lat, lng, meters) {
    const [asOf, res] = await Promise.all([
      layerDataDate(LAYER, ID),
      queryLayer(LAYER, {
        adapterId: ID,
        where: "1=1",
        outFields: FIELDS,
        returnGeometry: true,
        geometry: boxAround(lat, lng, meters / 1609.34),
        geometryType: "esriGeometryEnvelope",
        max: 400,
      }),
    ]);
    const fetchedAt = new Date().toISOString();
    return res.features
      .map((f) => toRecord(f, asOf, fetchedAt))
      .filter((r) => r.lat !== null && r.lng !== null)
      .sort((a, b) => distMiles(lat, lng, a.lat as number, a.lng as number) - distMiles(lat, lng, b.lat as number, b.lng as number));
  },

  async listByZip(zip, opts) {
    const extent = await zipExtent(zip);
    if (!extent) return { records: [], truncated: false, total: 0 };
    const max = opts.max ?? 30_000;
    const codes = codesFor(opts.types ?? []);
    const where = codes.length ? `DOR_UC IN (${codes.map(sqlString).join(",")})` : "1=1";
    const asOf = await layerDataDate(LAYER, ID);
    const PAGE = 2000;
    const features: Feature[] = [];
    let more = true;
    // The service is slow to count, so pages are pulled four at a time until one comes back short.
    for (let start = 0; more && start < max; start += PAGE * 4) {
      const pages = await Promise.all(
        [0, 1, 2, 3].map((i) =>
          queryLayer(LAYER, {
            adapterId: ID,
            where,
            outFields: FIELDS,
            returnGeometry: true,
            geometry: extent,
            geometryType: "esriGeometryEnvelope",
            orderBy: "OBJECTID",
            offset: start + i * PAGE,
            pageSize: PAGE,
            max: PAGE,
            timeoutMs: 120_000,
          }),
        ),
      );
      for (const p of pages) features.push(...p.features);
      more = pages[pages.length - 1].truncated;
    }
    const fetchedAt = new Date().toISOString();
    // The box around a zip code also catches its neighbors; keep only parcels the roll places in this zip.
    const records = features.map((f) => toRecord(f, asOf, fetchedAt)).filter((r) => r.zip.value === zip);
    return { records, truncated: more, total: records.length };
  },
};

export const statewideSales: SalesAdapter = {
  info: info(
    "Florida statewide tax roll — qualified sales",
    ["sales", "comps"],
    "Sales through about mid-2026 with month and year only. Uses the state's qualified-sale code instead of a price test.",
  ),

  async recentSalesNear(q: SalesQuery): Promise<SaleComp[]> {
    const sinceYear = Number(q.sinceIso.slice(0, 4));
    const clauses = [`DOR_UC = ${sqlString(q.useCode)}`, `SALE_YR1 >= ${sinceYear}`, "QUAL_CD1 IN ('01','02')", "SALE_PRC1 >= 10000"];
    if (q.minSqft !== null && q.maxSqft !== null) {
      clauses.push(`TOT_LVG_AR BETWEEN ${Math.floor(q.minSqft)} AND ${Math.ceil(q.maxSqft)}`);
    }
    const res = await queryLayer(LAYER, {
      adapterId: ID,
      where: clauses.join(" AND "),
      outFields: FIELDS,
      returnGeometry: true,
      geometry: boxAround(q.lat, q.lng, q.radiusMiles),
      geometryType: "esriGeometryEnvelope",
      max: 400,
    });
    const out: SaleComp[] = [];
    for (const f of res.features) {
      const a = f.attributes;
      const date = saleDate(a.SALE_YR1, a.SALE_MO1);
      if (!date || date < q.sinceIso.slice(0, 7) || !f.geometry) continue;
      const d = distMiles(q.lat, q.lng, f.geometry.y, f.geometry.x);
      if (d > q.radiusMiles) continue;
      out.push({
        folio: statewideId(Number(a.CO_NO), String(a.PARCEL_ID).trim()),
        address: str(a.PHY_ADDR1) ?? "Unknown",
        unit: str(a.PHY_ADDR2),
        saleDate: date,
        price: Number(a.SALE_PRC1),
        heatedSqft: posNum(a.TOT_LVG_AR),
        lotSqft: posNum(a.LND_SQFOOT),
        beds: null,
        baths: null,
        yearBuilt: posNum(a.ACT_YR_BLT),
        assessedValue: posNum(a.JV),
        distanceMiles: d,
        qualified: true,
      });
    }
    return out;
  },
};

/** Homestead and market value for a Miami-Dade folio, to fill what the county layer lacks. */
export async function statewideExtras(
  countyNo: number,
  parcelId: string,
): Promise<{ homestead: Sourced<boolean>; justValue: Sourced<number> } | null> {
  const rec = await statewideOwnership.getByFolio(statewideId(countyNo, parcelId));
  return rec ? { homestead: rec.homestead, justValue: rec.justValue } : null;
}
