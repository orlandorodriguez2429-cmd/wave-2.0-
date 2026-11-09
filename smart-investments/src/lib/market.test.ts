import { describe, expect, it } from "vitest";
import type { PropertyRecord, PropertyType } from "@/lib/adapters/types";
import { sourced } from "@/lib/sourced";
import { findBuyers, marketStats, recordIsMarketSale } from "./market";

const meta = { source: "test", fetchedAt: "2026-11-09T00:00:00Z" };
const s = <T>(v: T | null) => sourced<T>(v, meta);
const today = new Date("2026-11-09T12:00:00Z");
let n = 0;

function rec(o: {
  owner?: string;
  type?: PropertyType;
  date?: string | null;
  price?: number | null;
  sqft?: number;
  assessed?: number;
  mailing?: string;
  state?: string;
}): PropertyRecord {
  n += 1;
  const address = `${n} MAIN ST`;
  return {
    county: "miami-dade",
    folio: String(3000000000000 + n),
    address: s(address),
    unit: s<string>(null),
    city: s("MIAMI"),
    zip: s("33157"),
    lat: 25.6,
    lng: -80.3,
    owners: s([o.owner ?? `PERSON ${n}`]),
    mailingAddress: s(o.mailing ?? address),
    mailingCity: s("MIAMI"),
    mailingState: s(o.state ?? "FL"),
    mailingZip: s("33157"),
    mailingCountry: s("USA"),
    useCode: s("0101"),
    useDescription: s("SFR"),
    propertyType: o.type ?? "single_family",
    beds: s(3),
    baths: s(2),
    halfBaths: s<number>(null),
    floors: s(1),
    units: s(1),
    heatedSqft: s(o.sqft ?? 1000),
    totalSqft: s(1200),
    lotSqft: s(5000),
    yearBuilt: s(1970),
    assessedValue: s(o.assessed ?? 200_000),
    assessmentYear: s(2026),
    lastTransferDate: s(o.date === undefined ? "2000-01-01" : o.date),
    lastTransferPrice: s(o.price === undefined ? 150_000 : o.price),
  };
}

describe("market stats", () => {
  it("counts only market sales in the last 12 months and computes medians and trend", () => {
    const records = [
      // recent half: $400/sq ft ×5
      ...Array.from({ length: 5 }, () => rec({ date: "2026-08-01", price: 400_000 })),
      // prior half: $320/sq ft ×5
      ...Array.from({ length: 5 }, () => rec({ date: "2026-01-15", price: 320_000 })),
      rec({ date: "2026-09-01", price: 100 }), // deed transfer, not a sale
      rec({ date: "2024-01-01", price: 300_000 }), // too old
      ...Array.from({ length: 8 }, () => rec({})), // long-time owners
    ];
    const m = marketStats(records, today);
    const sf = m.byType.find((t) => t.type === "single_family")!;
    expect(m.sales12m).toBe(10);
    expect(sf.parcels).toBe(20);
    expect(sf.medianPrice).toBe(360_000);
    expect(sf.recent6PerSqft).toBe(400);
    expect(sf.prior6PerSqft).toBe(320);
    expect(sf.trend).toBeCloseTo(0.25, 6);
    expect(sf.turnover).toBeCloseTo(0.5, 6);
  });
  it("gives no trend when a half-year has too few sales", () => {
    const m = marketStats([rec({ date: "2026-08-01", price: 400_000 }), rec({ date: "2026-01-15", price: 320_000 })], today);
    expect(m.byType[0].trend).toBeNull();
  });
  it("measures investor share among recent buyers", () => {
    const m = marketStats(
      [
        rec({ owner: "ACME HOLDINGS LLC", date: "2026-06-01", price: 300_000, mailing: "9 OTHER RD" }),
        rec({ date: "2026-06-01", price: 300_000, mailing: "9 OTHER RD" }),
        rec({ date: "2026-06-01", price: 300_000 }),
        rec({ date: "2026-06-01", price: 300_000 }),
      ],
      today,
    );
    expect(m.investorShare).toBe(0.5);
    expect(m.companyShare).toBe(0.25);
  });
  it("applies the market-sale filter", () => {
    expect(recordIsMarketSale(rec({ price: 90_000, assessed: 300_000 }))).toBe(false);
    expect(recordIsMarketSale(rec({ price: null }))).toBe(false);
    expect(recordIsMarketSale(rec({ price: 250_000 }))).toBe(true);
  });
});

describe("buyer discovery", () => {
  it("finds companies and repeat buyers, and skips one-time owner-occupants", () => {
    const buyers = findBuyers(
      [
        rec({ owner: "SUNSHINE HOMES LLC", date: "2026-07-01", price: 300_000, mailing: "1 BIZ PKWY" }),
        rec({ owner: "Sunshine Homes, LLC", date: "2026-03-01", price: 350_000, mailing: "1 BIZ PKWY" }),
        rec({ owner: "JANE ROE", date: "2026-05-01", price: 280_000, mailing: "5 HER ST" }),
        rec({ owner: "JANE ROE", date: "2026-02-01", price: 260_000, mailing: "5 HER ST" }),
        rec({ owner: "ONE TIME BUYER", date: "2026-05-01", price: 400_000 }),
        rec({ owner: "OLD CO LLC", date: "2020-05-01", price: 400_000 }),
        rec({ owner: "DEED ONLY LLC", date: "2026-05-01", price: 100 }),
      ],
      today,
    );
    expect(buyers.map((b) => b.name)).toEqual(["SUNSHINE HOMES LLC", "JANE ROE"]);
    expect(buyers[0].purchases).toHaveLength(2);
    expect(buyers[0].totalSpent).toBe(650_000);
    expect(buyers[0].purchases[0].date).toBe("2026-07-01");
    expect(buyers[1].allAbsentee).toBe(true);
  });
});
