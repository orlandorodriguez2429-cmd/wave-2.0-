import { describe, expect, it } from "vitest";
import type { DistressSignal, PropertyRecord, SaleComp } from "@/lib/adapters/types";
import { typeFromUseCode } from "@/lib/adapters/miami-dade";
import { formatFolio, parseQuery, streetCandidates } from "@/lib/address";
import { streetNameTokens } from "@/lib/report";
import { sourced } from "@/lib/sourced";
import { estimateValue, isMarketSale, percentile, usableComps } from "./comps";
import { deedDocStamps, floridaGotchas } from "./florida";
import { analyzeOwner, classifyOwner } from "./owner";
import { motivationScore } from "./score";
import {
  brrrr,
  dealGrade,
  DEFAULT_ASSUMPTIONS as A,
  flip,
  loanBalance,
  monthlyPayment,
  quickRepair,
  rental,
  wholesale,
} from "./strategies";

const meta = { source: "test", fetchedAt: "2026-11-09T00:00:00Z" };
const s = <T>(v: T | null) => sourced<T>(v, meta);

function prop(over: Partial<Record<string, unknown>> = {}): PropertyRecord {
  const base: PropertyRecord = {
    county: "miami-dade",
    countyName: "Miami-Dade",
    parcelId: "x",
    justValue: s<number>(null),
    homestead: s<boolean>(null),
    lastTransferQualified: null,
    olderTransfersUnknown: false,
    folio: "3012340000010",
    address: s("123 SW 5 ST"),
    unit: s<string>(null),
    city: s("MIAMI"),
    zip: s("33130"),
    lat: 25.7,
    lng: -80.2,
    owners: s(["JOHN DOE"]),
    mailingAddress: s("123 SW 5 ST"),
    mailingCity: s("MIAMI"),
    mailingState: s("FL"),
    mailingZip: s("33130"),
    mailingCountry: s("USA"),
    useCode: s("0101"),
    useDescription: s("RESIDENTIAL - SINGLE FAMILY : 1 UNIT"),
    propertyType: "single_family",
    beds: s(3),
    baths: s(2),
    halfBaths: s<number>(null),
    floors: s(1),
    units: s(1),
    heatedSqft: s(1500),
    totalSqft: s(1800),
    lotSqft: s(6000),
    yearBuilt: s(1975),
    assessedValue: s(300_000),
    assessmentYear: s(2026),
    lastTransferDate: s("2005-06-01"),
    lastTransferPrice: s(210_000),
  };
  return { ...base, ...(over as Partial<PropertyRecord>) };
}

const comp = (over: Partial<SaleComp>): SaleComp => ({
  folio: "x",
  address: "1 A ST",
  unit: null,
  saleDate: "2026-08-01",
  price: 450_000,
  heatedSqft: 1500,
  lotSqft: 6000,
  beds: 3,
  baths: 2,
  yearBuilt: 1970,
  assessedValue: 300_000,
  distanceMiles: 0.2,
  ...over,
});

describe("address parsing", () => {
  it("normalizes a typed address to county form", () => {
    const q = parseQuery("10236 West 32nd Way, Hialeah, FL 33018");
    expect(q).toMatchObject({ kind: "address", street: "10236 W 32 WAY", zip: "33018", unit: null });
  });
  it("pulls out units and handles no-comma input", () => {
    const q = parseQuery("1200 Brickell Bay Drive Apt 2104 Miami FL 33131");
    expect(q).toMatchObject({ kind: "address", street: "1200 BRICKELL BAY DR", unit: "2104", zip: "33131" });
    const q2 = parseQuery("123 SW 5th Street Miami FL");
    expect(q2.kind === "address" && streetCandidates(q2.tokens)).toEqual([
      "123 SW 5 ST MIAMI",
      "123 SW 5 ST",
      "123 SW 5",
    ]);
  });
  it("reduces a street to its identifying words so 15th Ave cannot match 14th Ave", () => {
    expect(streetNameTokens(["SW", "15TH", "AVE", "FORT", "LAUDERDALE"])).toEqual(["15", "FORT", "LAUDERDALE"]);
    expect(streetNameTokens(["SW", "14", "AVE"])).toEqual(["14"]);
    expect(streetNameTokens(["N", "OLIVE", "AVE"])).toEqual(["OLIVE"]);
  });
  it("recognizes folio numbers with or without dashes", () => {
    expect(parseQuery("04-2016-006-1320")).toEqual({ kind: "folio", folio: "0420160061320" });
    expect(formatFolio("0420160061320")).toBe("04-2016-006-1320");
  });
});

describe("owner intelligence", () => {
  const today = new Date("2026-11-09T12:00:00Z");
  it("flags an owner-occupant with long ownership", () => {
    const o = analyzeOwner(prop(), today);
    expect(o).toMatchObject({ kind: "individual", absentee: false, outOfState: false, yearsSinceTransfer: 21 });
  });
  it("flags absentee and out-of-state owners", () => {
    const o = analyzeOwner(
      prop({ mailingAddress: s("9 MAIN ST"), mailingState: s("NY"), mailingZip: s("10001") }),
      today,
    );
    expect(o.absentee).toBe(true);
    expect(o.outOfState).toBe(true);
  });
  it("treats a condo mailing address with the unit appended as owner-occupied", () => {
    const o = analyzeOwner(prop({ address: s("100 BAYVIEW DR"), mailingAddress: s("100 BAYVIEW DR 1204") }), today);
    expect(o.absentee).toBe(false);
  });
  it("does not call an owner absentee over a zip mismatch alone when street and city match", () => {
    const o = analyzeOwner(prop({ zip: s("33312"), mailingZip: s("33321"), city: s("TAMARAC"), mailingCity: s("Tamarac") }), today);
    expect(o.absentee).toBe(false);
    const other = analyzeOwner(prop({ zip: s("33312"), mailingZip: s("33321"), city: s("TAMARAC"), mailingCity: s("MIAMI") }), today);
    expect(other.absentee).toBe(true);
  });
  it("returns Unknown (null) when data is missing instead of guessing", () => {
    const o = analyzeOwner(prop({ mailingAddress: s<string>(null), mailingState: s<string>(null), lastTransferDate: s<string>(null) }), today);
    expect(o.absentee).toBeNull();
    expect(o.outOfState).toBeNull();
    expect(o.yearsSinceTransfer).toBeNull();
  });
  it("classifies owner names", () => {
    expect(classifyOwner(["DALEJ LLC"])).toBe("company");
    expect(classifyOwner(["CITY OF HIALEAH"])).toBe("government");
    expect(classifyOwner(["MARIA PEREZ TRS"])).toBe("trust");
    expect(classifyOwner(["MARIA PEREZ"])).toBe("individual");
    expect(classifyOwner(null)).toBe("unknown");
  });
});

describe("comps and value", () => {
  it("drops non-market transfers and the subject itself", () => {
    expect(isMarketSale(comp({ price: 100 }))).toBe(false);
    expect(isMarketSale(comp({ price: 90_000, assessedValue: 300_000 }))).toBe(false);
    expect(isMarketSale(comp({ price: 450_000 }))).toBe(true);
    const list = usableComps("subject", [comp({ folio: "subject" }), comp({ folio: "a" }), comp({ folio: "b", price: 0 })]);
    expect(list.map((c) => c.folio)).toEqual(["a"]);
  });
  it("estimates from median price per sq ft", () => {
    const comps = [300, 320, 340, 360, 380].map((ppsf, i) => comp({ folio: `c${i}`, price: ppsf * 1500 }));
    const v = estimateValue({ heatedSqft: 1000, lotSqft: 5000 }, comps, 0);
    expect(v.likely).toBe(340_000);
    expect(v.low).toBe(320_000);
    expect(v.high).toBe(360_000);
    expect(v.confidence).toBe("high");
  });
  it("lowers confidence when the search had to widen or comps are few", () => {
    const comps = [comp({ folio: "a" }), comp({ folio: "b" }), comp({ folio: "c" })];
    expect(estimateValue({ heatedSqft: 1500, lotSqft: null }, comps, 1).confidence).toBe("medium");
    expect(estimateValue({ heatedSqft: 1500, lotSqft: null }, comps, 2).confidence).toBe("low");
    expect(estimateValue({ heatedSqft: 1500, lotSqft: null }, [], 0).likely).toBeNull();
  });
  it("computes percentiles", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe("Florida costs", () => {
  it("Miami-Dade single-family: $0.60 per $100, no surtax", () => {
    expect(deedDocStamps(400_000, "miami-dade", "single_family")).toBe(2400);
    expect(deedDocStamps(400_000, "miami-dade", "condo")).toBe(2400);
  });
  it("Miami-Dade duplex: adds the $0.45 surtax", () => {
    expect(deedDocStamps(400_000, "miami-dade", "duplex")).toBe(4200);
  });
  it("other counties: $0.70 per $100, rounding partial hundreds up", () => {
    expect(deedDocStamps(400_000, "broward", "single_family")).toBe(2800);
    expect(deedDocStamps(400_050, "broward", "single_family")).toBe(2800.7);
  });
  it("says Unknown for violations on city property and never claims flood data", () => {
    const g = floridaGotchas({
      type: "condo",
      yearBuilt: 1980,
      floors: 10,
      assessedValue: 200_000,
      violationsCovered: false,
      openViolationCount: 0,
      city: "HIALEAH",
      today: new Date("2026-11-09"),
    });
    expect(g.find((x) => x.key === "violations")?.status).toBe("unknown");
    expect(g.find((x) => x.key === "flood")?.status).toBe("unknown");
    expect(g.some((x) => x.key === "condo")).toBe(true);
    expect(g.some((x) => x.key === "recert")).toBe(true);
  });
});

describe("state-qualified sales", () => {
  it("trusts the state's qualification code over the price test", () => {
    expect(isMarketSale(comp({ price: 90_000, assessedValue: 300_000, qualified: true }))).toBe(true);
    expect(isMarketSale(comp({ price: 450_000, qualified: false }))).toBe(false);
  });
});

describe("flood zone check", () => {
  const base = { type: "single_family" as const, yearBuilt: 2005, floors: 1, assessedValue: 1, violationsCovered: true, openViolationCount: 0, city: null };
  it("warns in a Special Flood Hazard Area and stays informational outside one", () => {
    const high = floridaGotchas({ ...base, flood: { zone: "AE", subtype: null, sfha: true } }).find((g) => g.key === "flood");
    expect(high?.status).toBe("warning");
    expect(high?.title).toMatch(/AE/);
    const low = floridaGotchas({ ...base, flood: { zone: "X", subtype: "AREA OF MINIMAL FLOOD HAZARD", sfha: false } }).find((g) => g.key === "flood");
    expect(low?.status).toBe("info");
  });
});

describe("strategies", () => {
  it("wholesale MAO = ARV × 70% − repairs − fee", () => {
    const w = wholesale(400_000, 50_000, A);
    expect(w.buyerMax).toBe(230_000);
    expect(w.mao).toBe(220_000);
    expect(w.walkAway).toBe(220_000);
    expect(w.opening).toBeLessThan(w.target);
  });
  it("mortgage payment matches the standard formula", () => {
    expect(monthlyPayment(200_000, 0.06, 30)).toBeCloseTo(1199.1, 1);
    expect(monthlyPayment(120_000, 0, 10)).toBe(1000);
    expect(loanBalance(200_000, 0.06, 30, 360)).toBeCloseTo(0, 0);
  });
  it("flip profit adds up", () => {
    const f = flip({ arv: 400_000, purchase: 220_000, repairs: 50_000, insuranceAnnual: 6000, docStampsOnSale: 2400, a: A });
    expect(f.loanAmount).toBe(229_500);
    expect(f.interest).toBeCloseTo(13_770, 0);
    expect(f.profit).toBeCloseTo(400_000 - f.totalCosts, 6);
    expect(f.profit).toBeGreaterThan(60_000);
    expect(f.annualizedRoi).toBeCloseTo((f.roi as number) * 2, 6);
  });
  it("rental metrics", () => {
    const r = rental({ purchase: 300_000, repairs: 0, monthlyRent: 3000, insuranceAnnual: 6000, hoaMonthly: null, units: 2, a: A });
    expect(r.grossRentAnnual).toBe(36_000);
    expect(r.noi).toBeCloseTo(36_000 - 1800 - (6000 + 6000 + 2880 + 2880), 6);
    expect(r.onePercentRule).toBeCloseTo(0.01, 6);
    expect(r.pricePerDoor).toBe(150_000);
    expect(r.dscr).toBeCloseTo(r.noi / r.debtServiceAnnual, 6);
  });
  it("BRRRR: cash left in is all-in plus refi costs minus the new loan", () => {
    const b = brrrr({ arv: 400_000, purchase: 220_000, repairs: 50_000, monthlyRent: 3200, insuranceAnnual: 6000, hoaMonthly: null, a: A });
    expect(b.refiLoan).toBe(300_000);
    expect(b.cashLeftIn).toBeCloseTo(b.allIn + 6000 - 300_000, 6);
    expect(b.allInToArv).toBeGreaterThan(0.67);
  });
  it("quick repair uses the per-sq-ft tiers", () => {
    expect(quickRepair(1500, "light", A)).toBe(37_500);
    expect(quickRepair(1500, "heavy", A)).toBe(105_000);
  });
  it("grades by discount to ARV and drops a letter on low confidence", () => {
    expect(dealGrade(230_000, 50_000, 400_000, false)?.grade).toBe("A");
    expect(dealGrade(230_000, 50_000, 400_000, true)?.grade).toBe("B");
    expect(dealGrade(380_000, 50_000, 400_000, false)?.grade).toBe("F");
    expect(dealGrade(0, 0, 400_000, false)).toBeNull();
  });
});

describe("motivation score", () => {
  const sig = (type: DistressSignal["type"], open = true): DistressSignal => ({
    type,
    folio: "3012340000010",
    caseNumber: "1",
    description: "Minimum Housing Maintenance",
    status: open ? "Open" : "Closed",
    openedAt: "2026-10-14",
    open,
    source: "test",
    asOf: null,
    fetchedAt: meta.fetchedAt,
  });
  const today = new Date("2026-11-09T12:00:00Z");

  it("stacks signals and explains each one", () => {
    const owner = analyzeOwner(prop({ mailingAddress: s("9 MAIN ST"), mailingState: s("NY"), mailingZip: s("10001") }), today);
    const r = motivationScore({ owner, signals: [sig("code_violation"), sig("expired_permit")], violationsCovered: true });
    // code 10 + expired permit 5 + absentee 8 + out-of-state 5 + 15+ years 8
    expect(r.score).toBe(36);
    expect(r.reasons).toHaveLength(5);
    expect(r.reasons[0].points).toBe(10);
  });
  it("ignores closed cases and caps at 100", () => {
    const owner = analyzeOwner(prop(), today);
    expect(motivationScore({ owner, signals: [sig("unsafe_structure", false)], violationsCovered: true }).score).toBe(8);
  });
  it("lists what could not be checked, including violations for city parcels", () => {
    const owner = analyzeOwner(prop(), today);
    const r = motivationScore({ owner, signals: [], violationsCovered: false });
    expect(r.notChecked[0]).toMatch(/city property/);
    expect(r.notChecked.some((n) => /Lis pendens/.test(n))).toBe(true);
  });
});

describe("use codes", () => {
  it("maps Miami-Dade DOR codes to property types", () => {
    expect(typeFromUseCode("0101")).toBe("single_family");
    expect(typeFromUseCode("0407")).toBe("condo");
    expect(typeFromUseCode("0802")).toBe("duplex");
    expect(typeFromUseCode("8940")).toBe("other");
    expect(typeFromUseCode(null)).toBe("other");
  });
});
