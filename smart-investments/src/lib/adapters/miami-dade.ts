// Miami-Dade County free adapters, built on the county's public ArcGIS open-data layers.
//
//  - Property Point View  : Property Appraiser data for every parcel in the county
//                           (all cities, including Hialeah). Publisher says: updated weekly, Saturday.
//  - Code Compliance Violation / Building Violation : county enforcement cases.
//                           These cover UNINCORPORATED Miami-Dade only. Cities run their own
//                           code enforcement and are not in these layers.
//
// Verified against the live services on 11/09/2026.

import { sourced, type Sourced } from "@/lib/sourced";
import { countLayer, layerDataDate, queryLayer, sqlString, type Feature } from "./arcgis";
import type {
  AdapterInfo,
  Box,
  DistressAdapter,
  DistressSignal,
  OwnershipAdapter,
  PropertyRecord,
  PropertyType,
  SaleComp,
  SalesAdapter,
  SalesQuery,
} from "./types";

const ORG = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services";
const PA_LAYER = `${ORG}/PaGISView_gdb/FeatureServer/0`;
const CODE_LAYER = `${ORG}/CCVIOL_gdb/FeatureServer/0`;
const BLDG_LAYER = `${ORG}/BuildingViolation_gdb/FeatureServer/0`;

const PA_SOURCE = "Miami-Dade Property Appraiser (Property Point View, county open data)";
const CODE_SOURCE = "Miami-Dade Code Compliance (county open data, unincorporated areas only)";
const BLDG_SOURCE = "Miami-Dade Building Violations (county open data, unincorporated areas only)";

const PA_FIELDS = [
  "FOLIO",
  "TRUE_SITE_ADDR_NO_UNIT",
  "TRUE_SITE_UNIT",
  "TRUE_SITE_CITY",
  "TRUE_SITE_ZIP_CODE",
  "TRUE_MAILING_ADDR1",
  "TRUE_MAILING_ADDR2",
  "TRUE_MAILING_CITY",
  "TRUE_MAILING_STATE",
  "TRUE_MAILING_ZIP_CODE",
  "TRUE_MAILING_COUNTRY",
  "TRUE_OWNER1",
  "TRUE_OWNER2",
  "TRUE_OWNER3",
  "DOR_CODE_CUR",
  "DOR_DESC",
  "BEDROOM_COUNT",
  "BATHROOM_COUNT",
  "HALF_BATHROOM_COUNT",
  "FLOOR_COUNT",
  "UNIT_COUNT",
  "BUILDING_ACTUAL_AREA",
  "BUILDING_HEATED_AREA",
  "LOT_SIZE",
  "YEAR_BUILT",
  "ASSESSMENT_YEAR_CUR",
  "ASSESSED_VAL_CUR",
  "PRICE_1",
  "DATEOFSALE_UTC",
];

/** Florida DOR use codes as Miami-Dade publishes them (code + subcode). */
const TYPE_CODES: Record<Exclude<PropertyType, "other">, string[]> = {
  single_family: ["0101", "0104", "0105"],
  condo: ["0407"],
  townhouse: ["0410"],
  duplex: ["0802"],
  multifamily_small: ["0803"],
  multifamily_large: ["0303"],
  coop: ["0508"],
  vacant_land: ["0081"],
};

export function typeFromUseCode(code: string | null): PropertyType {
  if (!code) return "other";
  for (const [type, codes] of Object.entries(TYPE_CODES)) {
    if (codes.includes(code)) return type as PropertyType;
  }
  return "other";
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** The county stores 0 where a number does not apply or was never recorded; treat 0 as Unknown. */
function posNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isoFromMs(v: unknown): string | null {
  return typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null;
}

function toRecord(f: Feature, asOf: string | null, fetchedAt: string): PropertyRecord {
  const a = f.attributes;
  const s = <T>(value: T | null, note?: string): Sourced<T> =>
    sourced<T>(value, { source: PA_SOURCE, asOf, fetchedAt, confidence: "high", note });
  const owners = [str(a.TRUE_OWNER1), str(a.TRUE_OWNER2), str(a.TRUE_OWNER3)].filter((o): o is string => !!o);
  const mailing = [str(a.TRUE_MAILING_ADDR1), str(a.TRUE_MAILING_ADDR2)].filter(Boolean).join(" ") || null;
  const useCode = str(a.DOR_CODE_CUR);
  const price = typeof a.PRICE_1 === "number" ? a.PRICE_1 : null;
  return {
    county: "miami-dade",
    countyName: "Miami-Dade",
    folio: String(a.FOLIO).trim(),
    parcelId: String(a.FOLIO).trim(),
    address: s(str(a.TRUE_SITE_ADDR_NO_UNIT)),
    unit: s(str(a.TRUE_SITE_UNIT)),
    city: s(str(a.TRUE_SITE_CITY)),
    zip: s(str(a.TRUE_SITE_ZIP_CODE)?.slice(0, 5) ?? null),
    lat: f.geometry?.y ?? null,
    lng: f.geometry?.x ?? null,
    owners: s(owners.length ? owners : null),
    mailingAddress: s(mailing),
    mailingCity: s(str(a.TRUE_MAILING_CITY)),
    mailingState: s(str(a.TRUE_MAILING_STATE)),
    mailingZip: s(str(a.TRUE_MAILING_ZIP_CODE)?.slice(0, 5) ?? null),
    mailingCountry: s(str(a.TRUE_MAILING_COUNTRY)),
    useCode: s(useCode),
    useDescription: s(str(a.DOR_DESC)),
    propertyType: typeFromUseCode(useCode),
    beds: s(posNum(a.BEDROOM_COUNT)),
    baths: s(posNum(a.BATHROOM_COUNT)),
    halfBaths: s(posNum(a.HALF_BATHROOM_COUNT)),
    floors: s(posNum(a.FLOOR_COUNT)),
    units: s(posNum(a.UNIT_COUNT)),
    heatedSqft: s(posNum(a.BUILDING_HEATED_AREA)),
    totalSqft: s(posNum(a.BUILDING_ACTUAL_AREA)),
    lotSqft: s(posNum(a.LOT_SIZE)),
    yearBuilt: s(posNum(a.YEAR_BUILT)),
    assessedValue: s(posNum(a.ASSESSED_VAL_CUR)),
    justValue: s<number>(null),
    assessmentYear: s(posNum(a.ASSESSMENT_YEAR_CUR)),
    homestead: s<boolean>(null),
    lastTransferDate: s(isoFromMs(a.DATEOFSALE_UTC)),
    lastTransferPrice: s(price, "Recorded price of the last deed transfer. $0 or $100 means a non-market transfer."),
    lastTransferQualified: null,
    olderTransfersUnknown: false,
  };
}

// Records already fetched by a search are reused by the report instead of asking the county again.
const RECORD_TTL_MS = 6 * 60 * 60 * 1000;
const recordCache = new Map<string, { at: number; record: PropertyRecord }>();
function remember(record: PropertyRecord): PropertyRecord {
  if (recordCache.size > 5000) recordCache.clear();
  recordCache.set(record.folio, { at: Date.now(), record });
  return record;
}

const freeInfo = (id: string, name: string, dataTypes: string[], coverage: string, note: string): AdapterInfo => ({
  id,
  name,
  dataTypes,
  tier: "free",
  costPerCall: 0,
  enabled: true,
  coverage,
  note,
});

export const miamiDadeOwnership: OwnershipAdapter = {
  info: freeInfo(
    "mdc-property-appraiser",
    "Miami-Dade Property Appraiser — Property Point View",
    ["ownership", "building", "last transfer"],
    "All of Miami-Dade County, every city",
    "Updated weekly (Saturday) by the county. No homestead flag, no mortgage data, only the most recent transfer.",
  ),

  async getByFolio(folio) {
    const hit = recordCache.get(folio);
    if (hit && Date.now() - hit.at < RECORD_TTL_MS) return hit.record;
    const [asOf, res] = await Promise.all([
      layerDataDate(PA_LAYER, this.info.id),
      queryLayer(PA_LAYER, {
        adapterId: this.info.id,
        where: `FOLIO = ${sqlString(folio)}`,
        outFields: PA_FIELDS,
        returnGeometry: true,
        max: 1,
      }),
    ]);
    const f = res.features[0];
    return f ? remember(toRecord(f, asOf, new Date().toISOString())) : null;
  },

  async searchByAddress(streets, opts) {
    // Exact matches on several candidate spellings in one request are much faster on this
    // layer than a prefix search, so the caller tries "exact" first and "prefix" only if needed.
    const match =
      opts.mode === "exact"
        ? `TRUE_SITE_ADDR_NO_UNIT IN (${streets.map(sqlString).join(",")})`
        : `TRUE_SITE_ADDR_NO_UNIT LIKE ${sqlString(`${streets[0]}%`)}`;
    const clauses = [match];
    if (opts.zip) clauses.push(`TRUE_SITE_ZIP_CODE LIKE ${sqlString(`${opts.zip}%`)}`);
    if (opts.unit) clauses.push(`TRUE_SITE_UNIT = ${sqlString(opts.unit)}`);
    const [asOf, res] = await Promise.all([
      layerDataDate(PA_LAYER, this.info.id),
      queryLayer(PA_LAYER, {
        adapterId: this.info.id,
        where: clauses.join(" AND "),
        outFields: PA_FIELDS,
        returnGeometry: true,
        orderBy: "TRUE_SITE_ADDR_NO_UNIT, TRUE_SITE_UNIT",
        max: 25,
      }),
    ]);
    const fetchedAt = new Date().toISOString();
    return res.features.map((f) => remember(toRecord(f, asOf, fetchedAt)));
  },

  async nearestToPoint(lat, lng, meters) {
    const [asOf, res] = await Promise.all([
      layerDataDate(PA_LAYER, this.info.id),
      queryLayer(PA_LAYER, {
        adapterId: this.info.id,
        where: "1=1",
        outFields: PA_FIELDS,
        returnGeometry: true,
        geometry: `${lng},${lat}`,
        distanceMeters: meters,
        max: 25,
      }),
    ]);
    const fetchedAt = new Date().toISOString();
    return res.features
      .map((f) => remember(toRecord(f, asOf, fetchedAt)))
      .sort((a, b) => distMiles(lat, lng, a.lat, a.lng) - distMiles(lat, lng, b.lat, b.lng));
  },

  async listByZip(zip, opts) {
    const clauses = [`TRUE_SITE_ZIP_CODE LIKE ${sqlString(`${zip}%`)}`];
    const codes = (opts.types ?? []).flatMap((t) => (t === "other" ? [] : TYPE_CODES[t]));
    if (codes.length) clauses.push(`DOR_CODE_CUR IN (${codes.map(sqlString).join(",")})`);
    const where = clauses.join(" AND ");
    const max = opts.max ?? 10_000;
    const [asOf, total] = await Promise.all([
      layerDataDate(PA_LAYER, this.info.id),
      countLayer(PA_LAYER, this.info.id, where),
    ]);
    // Pages are fetched a few at a time; one after another is too slow for a whole zip code.
    const PAGE = 2000;
    const offsets: number[] = [];
    for (let o = 0; o < Math.min(total, max); o += PAGE) offsets.push(o);
    const features: Feature[] = [];
    for (let i = 0; i < offsets.length; i += 4) {
      const pages = await Promise.all(
        offsets.slice(i, i + 4).map((offset) =>
          queryLayer(PA_LAYER, {
            adapterId: this.info.id,
            where,
            outFields: PA_FIELDS,
            returnGeometry: true,
            orderBy: "FOLIO",
            offset,
            pageSize: PAGE,
            max: PAGE,
          }),
        ),
      );
      for (const p of pages) features.push(...p.features);
    }
    const fetchedAt = new Date().toISOString();
    return {
      records: features.map((f) => toRecord(f, asOf, fetchedAt)),
      truncated: features.length < total,
      total,
    };
  },
};

export function distMiles(lat1: number, lng1: number, lat2: number | null, lng2: number | null): number {
  if (lat2 === null || lng2 === null) return Number.POSITIVE_INFINITY;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

export const miamiDadeSales: SalesAdapter = {
  info: freeInfo(
    "mdc-recent-transfers",
    "Miami-Dade recorded transfers (from Property Point View)",
    ["sales", "comps"],
    "All of Miami-Dade County",
    "Only each parcel's most recent transfer. No condition, photos or listing data, so values are as-is estimates, not ARV.",
  ),

  async recentSalesNear(q: SalesQuery): Promise<SaleComp[]> {
    const clauses = [
      `DOR_CODE_CUR = ${sqlString(q.useCode)}`,
      `DATEOFSALE_UTC >= DATE ${sqlString(q.sinceIso.slice(0, 10))}`,
      "PRICE_1 >= 10000",
    ];
    if (q.minSqft !== null && q.maxSqft !== null) {
      clauses.push(`BUILDING_HEATED_AREA BETWEEN ${Math.floor(q.minSqft)} AND ${Math.ceil(q.maxSqft)}`);
    }
    const res = await queryLayer(PA_LAYER, {
      adapterId: this.info.id,
      where: clauses.join(" AND "),
      outFields: PA_FIELDS,
      returnGeometry: true,
      geometry: `${q.lng},${q.lat}`,
      distanceMiles: q.radiusMiles,
      max: 300,
    });
    return res.features.map((f) => {
      const a = f.attributes;
      return {
        folio: String(a.FOLIO).trim(),
        address: str(a.TRUE_SITE_ADDR_NO_UNIT) ?? "Unknown",
        unit: str(a.TRUE_SITE_UNIT),
        saleDate: isoFromMs(a.DATEOFSALE_UTC) ?? "",
        price: Number(a.PRICE_1),
        heatedSqft: posNum(a.BUILDING_HEATED_AREA),
        lotSqft: posNum(a.LOT_SIZE),
        beds: posNum(a.BEDROOM_COUNT),
        baths: posNum(a.BATHROOM_COUNT),
        yearBuilt: posNum(a.YEAR_BUILT),
        assessedValue: posNum(a.ASSESSED_VAL_CUR),
        distanceMiles: f.geometry ? distMiles(q.lat, q.lng, f.geometry.y, f.geometry.x) : null,
      };
    });
  },
};

const CODE_FIELDS = ["CASE_NUM", "CASE_DATE", "CASE_STATUS", "STAT_DESC", "FOLIO", "PROBLEM_DESC"];
const BLDG_FIELDS = ["CASE_NUM", "CASE_TYPE", "FOLIO", "OPEN_DATE", "CLOSED_DATE"];

function codeSignal(f: Feature, asOf: string | null, fetchedAt: string): DistressSignal {
  const a = f.attributes;
  const status = str(a.STAT_DESC) ?? "Unknown";
  const desc = str(a.PROBLEM_DESC) ?? "Code violation";
  const open = str(a.CASE_STATUS) !== "2";
  let type: DistressSignal["type"] = "code_violation";
  if (/foreclos/i.test(desc)) type = "foreclosure_registry";
  else if (str(a.CASE_STATUS) === "4") type = "code_violation_lien";
  return {
    type,
    folio: String(a.FOLIO ?? "").trim(),
    caseNumber: str(a.CASE_NUM) ?? "",
    description: desc,
    status,
    openedAt: isoFromMs(a.CASE_DATE),
    open,
    source: CODE_SOURCE,
    asOf,
    fetchedAt,
  };
}

function bldgSignal(f: Feature, asOf: string | null, fetchedAt: string): DistressSignal {
  const a = f.attributes;
  const caseType = str(a.CASE_TYPE) ?? "Building violation";
  const open = a.CLOSED_DATE === null || a.CLOSED_DATE === undefined;
  let type: DistressSignal["type"] = "building_violation";
  if (/unsafe/i.test(caseType)) type = "unsafe_structure";
  else if (/expired permit/i.test(caseType)) type = "expired_permit";
  return {
    type,
    folio: String(a.FOLIO ?? "").trim(),
    caseNumber: str(a.CASE_NUM) ?? "",
    description: caseType,
    status: open ? "Open" : "Closed",
    openedAt: isoFromMs(a.OPEN_DATE),
    open,
    source: BLDG_SOURCE,
    asOf,
    fetchedAt,
  };
}

export const miamiDadeDistress: DistressAdapter = {
  info: freeInfo(
    "mdc-violations",
    "Miami-Dade code compliance + building violations",
    ["distress: code violations, liens, unsafe structures, expired permits, foreclosure registry"],
    "Unincorporated Miami-Dade only (folios starting with 30)",
    "Updated daily by the county. Cities (Hialeah, Miami, Miami Gardens…) are NOT covered; their violations show as Unknown.",
  ),

  // Miami-Dade folio numbers start with a two-digit municipality code; 30 is unincorporated county.
  covers(folio) {
    return folio.startsWith("30");
  },

  async getForFolio(folio) {
    const [codeAsOf, bldgAsOf, code, bldg] = await Promise.all([
      layerDataDate(CODE_LAYER, this.info.id),
      layerDataDate(BLDG_LAYER, this.info.id),
      queryLayer(CODE_LAYER, {
        adapterId: this.info.id,
        where: `FOLIO LIKE ${sqlString(`${folio}%`)}`,
        outFields: CODE_FIELDS,
        max: 200,
      }),
      queryLayer(BLDG_LAYER, {
        adapterId: this.info.id,
        where: `FOLIO = ${sqlString(folio)}`,
        outFields: BLDG_FIELDS,
        max: 200,
      }),
    ]);
    const fetchedAt = new Date().toISOString();
    return [
      ...code.features.map((f) => codeSignal(f, codeAsOf, fetchedAt)),
      ...bldg.features.map((f) => bldgSignal(f, bldgAsOf, fetchedAt)),
    ].sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""));
  },

  async openSignalsInBox(box: Box) {
    const envelope = `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`;
    const [codeAsOf, bldgAsOf, code, bldg] = await Promise.all([
      layerDataDate(CODE_LAYER, this.info.id),
      layerDataDate(BLDG_LAYER, this.info.id),
      queryLayer(CODE_LAYER, {
        adapterId: this.info.id,
        where: "CASE_STATUS <> '2'",
        outFields: CODE_FIELDS,
        geometry: envelope,
        geometryType: "esriGeometryEnvelope",
        max: 8000,
      }),
      queryLayer(BLDG_LAYER, {
        adapterId: this.info.id,
        where: "CLOSED_DATE IS NULL",
        outFields: BLDG_FIELDS,
        geometry: envelope,
        geometryType: "esriGeometryEnvelope",
        max: 8000,
      }),
    ]);
    const fetchedAt = new Date().toISOString();
    return [
      ...code.features.map((f) => codeSignal(f, codeAsOf, fetchedAt)),
      ...bldg.features.map((f) => bldgSignal(f, bldgAsOf, fetchedAt)),
    ];
  },
};
