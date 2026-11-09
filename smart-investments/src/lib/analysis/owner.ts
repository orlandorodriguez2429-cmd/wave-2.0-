import { addressKey } from "@/lib/address";
import type { PropertyRecord } from "@/lib/adapters/types";

export type OwnerKind = "individual" | "company" | "trust" | "government" | "unknown";

export interface OwnerIntel {
  kind: OwnerKind;
  /** Mailing address differs from the property address. null = cannot tell. */
  absentee: boolean | null;
  outOfState: boolean | null;
  outOfCountry: boolean | null;
  /** Whole years since the last recorded deed transfer. null = no transfer on record. */
  yearsSinceTransfer: number | null;
  /** The last transfer had a market-looking price (not a $0/$100 deed). */
  lastTransferWasMarketSale: boolean | null;
}

const GOVERNMENT = /\b(CITY OF|COUNTY|STATE OF|UNITED STATES|SCHOOL BOARD|HOUSING AUTHORITY|DEPT OF|DEPARTMENT OF)\b/;
const TRUST = /\b(TRUST|TRS|TRUSTEE|TR|REVOCABLE|LIVING TR|ESTATE OF|EST OF)\b/;
const COMPANY =
  /\b(LLC|L L C|INC|CORP|CORPORATION|CO|LTD|LP|LLP|LLLP|PLC|HOLDINGS|PROPERTIES|INVESTMENTS|INVESTMENT|GROUP|PARTNERS|CAPITAL|VENTURES|ENTERPRISES|REALTY|BANK|ASSOCIATION|ASSN|CHURCH|MINISTRIES|FOUNDATION|FUND|HOMES)\b/;

export function classifyOwner(names: string[] | null): OwnerKind {
  if (!names || names.length === 0) return "unknown";
  const all = names.join(" | ").toUpperCase();
  if (GOVERNMENT.test(all)) return "government";
  if (COMPANY.test(all)) return "company";
  if (TRUST.test(all)) return "trust";
  return "individual";
}

export function analyzeOwner(p: PropertyRecord, today: Date = new Date()): OwnerIntel {
  const site = addressKey(p.address.value);
  const mail = addressKey(p.mailingAddress.value);
  let absentee: boolean | null = null;
  if (site && mail) {
    // Condo mailing addresses usually repeat the street address plus the unit, so a prefix match counts as the same place.
    const sameStreet = mail === site || mail.startsWith(`${site} `);
    // Tax rolls sometimes carry a wrong site zip, so a matching city also counts as the same place.
    const sameZip = !p.zip.value || !p.mailingZip.value || p.zip.value === p.mailingZip.value;
    const sameCity =
      !!p.city.value && !!p.mailingCity.value && p.city.value.toUpperCase() === p.mailingCity.value.toUpperCase();
    absentee = !(sameStreet && (sameZip || sameCity));
  }

  const state = p.mailingState.value?.toUpperCase() ?? null;
  const country = p.mailingCountry.value?.toUpperCase() ?? null;
  const outOfCountry = country ? !["USA", "US", "UNITED STATES"].includes(country) : null;
  const outOfState = state ? state !== "FL" : outOfCountry === true ? true : null;

  let yearsSinceTransfer: number | null = null;
  if (p.lastTransferDate.value) {
    const d = new Date(p.lastTransferDate.value);
    yearsSinceTransfer = Math.floor((today.getTime() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  }
  const price = p.lastTransferPrice.value;
  const lastTransferWasMarketSale = price === null ? null : price >= 10_000;

  return {
    kind: classifyOwner(p.owners.value),
    absentee,
    outOfState,
    outOfCountry,
    yearsSinceTransfer,
    lastTransferWasMarketSale,
  };
}
