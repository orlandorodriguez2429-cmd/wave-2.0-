// Motivation Score 0–100 with reasons. Weights are the ones in the build brief and are
// passed in, so they can be edited from Settings once that screen exists.
//
// Only signals we actually have data for can add points. Signals with no data source
// yet are reported as "not checked" so a low score is never mistaken for "no distress".

import type { DistressSignal } from "@/lib/adapters/types";
import { fmtDate } from "@/lib/sourced";
import type { OwnerIntel } from "./owner";

export interface ScoreWeights {
  preForeclosure: number;
  auctionScheduled: number;
  taxDelinquent: number;
  probate: number;
  codeViolation: number;
  unsafeStructure: number;
  evictionFiled: number;
  vacant: number;
  absentee: number;
  outOfState: number;
  highEquity: number;
  freeAndClear: number;
  longOwnership: number;
  condoSpecialAssessment: number;
  expiredListing: number;
  /** Not in the brief; conservative additions for signals the county data does give us. */
  expiredPermit: number;
  violationLien: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  preForeclosure: 25,
  auctionScheduled: 30,
  taxDelinquent: 15,
  probate: 20,
  codeViolation: 10,
  unsafeStructure: 20,
  evictionFiled: 10,
  vacant: 15,
  absentee: 8,
  outOfState: 5,
  highEquity: 15,
  freeAndClear: 10,
  longOwnership: 8,
  condoSpecialAssessment: 12,
  expiredListing: 10,
  expiredPermit: 5,
  violationLien: 10,
};

export const LONG_OWNERSHIP_YEARS = 15;

export interface ScoreReason {
  label: string;
  points: number;
}

export interface MotivationScore {
  score: number;
  reasons: ScoreReason[];
  /** Signals that could not be checked with the data sources that are switched on. */
  notChecked: string[];
}

export const NOT_CHECKED_FREE_TIER = [
  "Lis pendens / pre-foreclosure (needs Clerk records)",
  "Auction date (needs auction data)",
  "Tax delinquency (needs Tax Collector data)",
  "Probate, divorce, evictions (need court records)",
  "Vacancy",
  "Equity and mortgages (need recorded mortgages)",
  "Condo special assessments",
  "Expired / withdrawn listings (need MLS)",
];

export function motivationScore(args: {
  owner: OwnerIntel;
  signals: DistressSignal[];
  violationsCovered: boolean;
  weights?: ScoreWeights;
}): MotivationScore {
  const w = args.weights ?? DEFAULT_WEIGHTS;
  const reasons: ScoreReason[] = [];
  const open = args.signals.filter((s) => s.open);
  const first = (type: DistressSignal["type"]) => open.find((s) => s.type === type);
  const dated = (s: DistressSignal) => (s.openedAt ? ` opened ${fmtDate(s.openedAt)}` : "");

  const registry = first("foreclosure_registry");
  if (registry) {
    reasons.push({
      label: `County foreclosed-property registry case (${registry.description.trim()})${dated(registry)}`,
      points: w.preForeclosure,
    });
  }
  const unsafe = first("unsafe_structure");
  if (unsafe) reasons.push({ label: `Open unsafe-structure case${dated(unsafe)}`, points: w.unsafeStructure });

  const lien = first("code_violation_lien");
  if (lien) reasons.push({ label: `Code violation with lien (${lien.description.trim()})`, points: w.violationLien });

  const code = first("code_violation") ?? first("building_violation");
  if (code && !unsafe) {
    const n = open.filter((s) => s.type === "code_violation" || s.type === "building_violation").length;
    reasons.push({
      label: `${n} open code/building violation${n === 1 ? "" : "s"} (latest: ${code.description.trim()}${dated(code)})`,
      points: w.codeViolation,
    });
  }
  const permit = first("expired_permit");
  if (permit) reasons.push({ label: `Expired permit case${dated(permit)}`, points: w.expiredPermit });

  const o = args.owner;
  if (o.kind !== "government") {
    if (o.absentee) reasons.push({ label: "Absentee owner (mailing address differs from property)", points: w.absentee });
    if (o.outOfState) {
      reasons.push({ label: o.outOfCountry ? "Owner mailing address is outside the U.S." : "Out-of-state owner", points: w.outOfState });
    }
    if (o.yearsSinceTransfer !== null && o.yearsSinceTransfer >= LONG_OWNERSHIP_YEARS) {
      reasons.push({ label: `No deed transfer in ${o.yearsSinceTransfer} years`, points: w.longOwnership });
    }
  }

  const notChecked = [...NOT_CHECKED_FREE_TIER];
  if (!args.violationsCovered) notChecked.unshift("Code and building violations (city property; county data does not cover it)");

  const score = Math.min(100, reasons.reduce((sum, r) => sum + r.points, 0));
  return { score, reasons: reasons.sort((a, b) => b.points - a.points), notChecked };
}
