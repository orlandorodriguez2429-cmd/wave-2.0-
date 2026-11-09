// FEMA National Flood Hazard Layer (official, free, no key). Layer 28 = Flood Hazard Zones.
// Verified against the live service on 11/09/2026.

import { queryLayer } from "./arcgis";
import type { AdapterInfo } from "./types";

const NFHL_ZONES = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";

export const femaInfo: AdapterInfo = {
  id: "fema-nfhl",
  name: "FEMA National Flood Hazard Layer",
  dataTypes: ["flood zone"],
  tier: "free",
  costPerCall: 0,
  enabled: true,
  coverage: "Nationwide",
  note: "Zone at the parcel's center point only. A lot can straddle two zones; lenders rely on a flood determination, not this lookup.",
};

export interface FloodZone {
  zone: string;
  subtype: string | null;
  /** In a Special Flood Hazard Area (lenders require flood insurance). */
  sfha: boolean | null;
  source: string;
  fetchedAt: string;
}

/** Returns null when FEMA has no mapped zone at the point or the service does not answer. */
export async function floodZoneAt(lat: number, lng: number): Promise<FloodZone | null> {
  const res = await queryLayer(NFHL_ZONES, {
    adapterId: femaInfo.id,
    where: "1=1",
    outFields: ["FLD_ZONE", "ZONE_SUBTY", "SFHA_TF"],
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    max: 5,
  });
  const a = res.features[0]?.attributes;
  if (!a || !a.FLD_ZONE) return null;
  const sfha = a.SFHA_TF === "T" ? true : a.SFHA_TF === "F" ? false : null;
  return {
    zone: String(a.FLD_ZONE),
    subtype: a.ZONE_SUBTY ? String(a.ZONE_SUBTY) : null,
    sfha,
    source: "FEMA National Flood Hazard Layer (zone at parcel center point)",
    fetchedAt: new Date().toISOString(),
  };
}
