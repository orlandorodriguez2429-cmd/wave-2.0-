// Florida-specific costs and warnings that belong in every report.

import type { County, PropertyType } from "@/lib/adapters/types";

/**
 * Documentary stamp tax on a deed. Charged per $100 of price, or any part of $100.
 *  - Miami-Dade: $0.60 per $100, plus a $0.45 per $100 surtax on everything except a
 *    single-family residence (a detached house or one condo unit).
 *  - Every other Florida county: $0.70 per $100.
 * Source: FL Dept. of Revenue documentary stamp tax page and rule 12B-4.012, read via
 * search summary on 11/09/2026. Confirm with the title company on every deal.
 */
export function deedDocStamps(price: number, county: County, type: PropertyType): number {
  if (!(price > 0)) return 0;
  const hundreds = Math.ceil(price / 100);
  if (county === "miami-dade") {
    const singleFamilyResidence = type === "single_family" || type === "condo" || type === "townhouse";
    return round2(hundreds * 0.6 + (singleFamilyResidence ? 0 : hundreds * 0.45));
  }
  return round2(hundreds * 0.7);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * After a sale the assessed value resets to market value (the seller's Save Our Homes
 * cap and homestead exemption do not transfer). The real bill depends on the millage
 * for that exact location, which we do not have yet, so this uses a rate the user sets.
 */
export function postSaleTaxEstimate(purchasePrice: number, effectiveRate: number): number {
  return Math.round(purchasePrice * effectiveRate);
}

export interface Gotcha {
  key: string;
  title: string;
  status: "warning" | "unknown" | "info";
  detail: string;
}

export function floridaGotchas(args: {
  type: PropertyType;
  yearBuilt: number | null;
  floors: number | null;
  assessedValue: number | null;
  violationsCovered: boolean;
  openViolationCount: number;
  city: string | null;
  today?: Date;
}): Gotcha[] {
  const year = (args.today ?? new Date()).getUTCFullYear();
  const age = args.yearBuilt ? year - args.yearBuilt : null;
  const shared = args.type === "condo" || args.type === "coop" || args.type === "multifamily_large";
  const out: Gotcha[] = [];

  out.push({
    key: "tax_reset",
    title: "Property taxes reset after you buy",
    status: "warning",
    detail:
      "The seller's tax bill is not your tax bill. Their Save Our Homes cap and homestead exemption end at sale and the county re-assesses at market value the next January 1. Underwrite with the post-sale estimate below, not the current bill." +
      (args.assessedValue ? ` Current assessed value: $${args.assessedValue.toLocaleString("en-US")}.` : ""),
  });

  out.push({
    key: "flood",
    title: "Flood zone and flood insurance",
    status: "unknown",
    detail:
      "Flood zone: Unknown. The FEMA adapter is not connected yet. Check the FEMA Flood Map Service Center and get a flood quote before making an offer.",
  });

  out.push({
    key: "wind",
    title: "Windstorm / homeowners insurance",
    status: "unknown",
    detail:
      "Insurance cost: Unknown. Get a real quote. Roof age, roof shape, opening protection and a wind mitigation report change the premium a lot in South Florida" +
      (age !== null && age >= 20 ? `; this building is about ${age} years old, so expect a 4-point inspection request.` : "."),
  });

  if (shared) {
    out.push({
      key: "condo",
      title: "Condo / co-op: reserves, inspections, special assessments",
      status: "unknown",
      detail:
        "Reserve study (SIRS) status, milestone inspection status and special assessments: Unknown. Ask the association for the SIRS, the latest milestone inspection report, the budget and any pending assessments. The state's SIRS filing list can be checked at the Florida DBPR.",
    });
  }

  if (age !== null && age >= 25 && (shared || (args.floors ?? 0) >= 3)) {
    out.push({
      key: "recert",
      title: "Building recertification / milestone inspection age",
      status: "warning",
      detail: `Built ${args.yearBuilt} (about ${age} years old). Larger and multi-story buildings of this age fall under Florida milestone inspection and local recertification rules. Ask the building department and the association whether it has been done and what repairs were ordered.`,
    });
  }

  out.push(
    args.violationsCovered
      ? {
          key: "violations",
          title: "Open violations and permits transfer with the property",
          status: args.openViolationCount > 0 ? "warning" : "info",
          detail:
            args.openViolationCount > 0
              ? `${args.openViolationCount} open county case(s) found (listed above). Fines and required repairs become the buyer's problem. Order a lien and open-permit search through the title company.`
              : "No open county code or building cases found in the county data. Still order a lien and open-permit search through the title company.",
        }
      : {
          key: "violations",
          title: "Open violations and permits transfer with the property",
          status: "unknown",
          detail: `Violations: Unknown. This property is inside ${args.city ? titleCase(args.city) : "a city"}, which runs its own code enforcement; county data does not cover it. Order a municipal lien and open-permit search before closing.`,
        },
  );

  return out;
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
