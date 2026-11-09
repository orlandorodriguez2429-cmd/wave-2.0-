// The adapter menu. Free adapters are live. Paid ones are listed with the key that
// will switch them on; until their code is written they stay "not built" rather than
// pretending to return data.

import { miamiDadeDistress, miamiDadeOwnership, miamiDadeSales } from "./miami-dade";
import type { AdapterInfo, County, DistressAdapter, OwnershipAdapter, SalesAdapter } from "./types";
import { getUsage } from "./usage";

export function ownershipFor(county: County): OwnershipAdapter | null {
  return county === "miami-dade" ? miamiDadeOwnership : null;
}

export function salesFor(county: County): SalesAdapter | null {
  return county === "miami-dade" ? miamiDadeSales : null;
}

export function distressFor(county: County): DistressAdapter | null {
  return county === "miami-dade" ? miamiDadeDistress : null;
}

const planned: AdapterInfo[] = [
  {
    id: "rentcast",
    name: "RentCast API",
    dataTypes: ["rent estimate", "valuation", "listings"],
    tier: "lean",
    costPerCall: 0,
    enabled: false,
    envKey: "RENTCAST_API_KEY",
    coverage: "Nationwide",
    note: "Not built yet. Free tier is 50 calls/month; paid tier prices need confirming on their site.",
  },
  {
    id: "mdc-clerk",
    name: "Miami-Dade Clerk official records",
    dataTypes: ["lis pendens", "liens", "deeds", "mortgages"],
    tier: "lean",
    costPerCall: 0.05,
    enabled: false,
    envKey: "MDC_CLERK_API_KEY",
    coverage: "Miami-Dade County",
    note: "Not built yet. Paid by the Clerk ($0.05 per request, or a monthly folder fee). Needed for pre-foreclosure and equity.",
  },
  {
    id: "skip-trace",
    name: "Skip tracing (vendor to be chosen)",
    dataTypes: ["owner phones", "owner emails", "DNC flag"],
    tier: "lean",
    costPerCall: 0.1,
    enabled: false,
    envKey: "SKIPTRACE_API_KEY",
    coverage: "Nationwide",
    note: "Not built yet. Roughly $0.02–$0.15 per record depending on vendor.",
  },
  {
    id: "mls",
    name: "MLS feed (Bridge / Trestle)",
    dataTypes: ["active listings", "sold listings", "photos"],
    tier: "plug-in",
    costPerCall: 0,
    enabled: false,
    envKey: "MLS_API_TOKEN",
    coverage: "Your MLS",
    note: "Not built yet. Needs your board's data license and broker approval for back-office use.",
  },
  {
    id: "fema-nfhl",
    name: "FEMA flood zones",
    dataTypes: ["flood zone"],
    tier: "free",
    costPerCall: 0,
    enabled: false,
    coverage: "Nationwide",
    note: "Not built yet. FEMA's map service refused connections during the 11/09/2026 build; flood zone shows as Unknown.",
  },
  {
    id: "broward",
    name: "Broward County property data",
    dataTypes: ["ownership", "sales"],
    tier: "free",
    costPerCall: 0,
    enabled: false,
    coverage: "Broward County",
    note: "Not built yet (Phase 5).",
  },
  {
    id: "palm-beach",
    name: "Palm Beach County property data",
    dataTypes: ["ownership", "sales"],
    tier: "free",
    costPerCall: 0,
    enabled: false,
    coverage: "Palm Beach County",
    note: "Not built yet (Phase 5).",
  },
];

export interface AdapterStatus extends AdapterInfo {
  callsThisSession: number;
  lastCallAt: string | null;
  costThisSession: number;
  keyPresent: boolean | null;
}

export function listAdapters(): AdapterStatus[] {
  const live = [miamiDadeOwnership.info, miamiDadeSales.info, miamiDadeDistress.info];
  return [...live, ...planned].map((info) => {
    const u = getUsage(info.id);
    return {
      ...info,
      callsThisSession: u.calls,
      lastCallAt: u.lastCallAt,
      costThisSession: u.calls * info.costPerCall,
      keyPresent: info.envKey ? Boolean(process.env[info.envKey]) : null,
    };
  });
}
