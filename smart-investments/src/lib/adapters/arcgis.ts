// Minimal ArcGIS REST client with an in-process cache and usage counters.
// Used only against official open-data services that publish these layers for public use.

import { recordCall } from "./usage";

type Attrs = Record<string, unknown>;
export interface Feature {
  attributes: Attrs;
  geometry?: { x: number; y: number };
}

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const FREE_TTL_MS = 6 * 60 * 60 * 1000; // public layers refresh daily/weekly; 6h is plenty

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 500);
    for (const [k] of oldest) cache.delete(k);
  }
  return value;
}

async function post(url: string, params: Record<string, string>, timeoutMs = 30_000): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, f: "json" });
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) {
        const e = json.error as { message?: string; details?: string[] };
        throw new Error(`ArcGIS error: ${e.message ?? "unknown"} ${(e.details ?? []).join(" ")}`);
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && err.message.startsWith("ArcGIS error")) break; // bad query; retrying won't help
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface QueryOpts {
  adapterId: string;
  where: string;
  outFields: string[];
  returnGeometry?: boolean;
  geometry?: string;
  geometryType?: "esriGeometryPoint" | "esriGeometryEnvelope";
  distanceMiles?: number;
  distanceMeters?: number;
  orderBy?: string;
  /** Hard cap on rows returned across pages. */
  max?: number;
  pageSize?: number;
  /** Start row. When set, exactly one page is fetched (used for parallel paging). */
  offset?: number;
  /** Ask only for the bounding box of the matching features. */
  returnExtentOnly?: boolean;
  timeoutMs?: number;
}

export interface Extent {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

export async function queryLayer(
  layerUrl: string,
  opts: QueryOpts,
): Promise<{ features: Feature[]; truncated: boolean; extent?: Extent | null }> {
  const max = opts.max ?? 2000;
  const pageSize = Math.min(opts.pageSize ?? 2000, max);
  const base: Record<string, string> = {
    where: opts.where,
    outFields: opts.outFields.join(","),
    returnGeometry: String(opts.returnGeometry ?? false),
    outSR: "4326",
  };
  if (opts.orderBy) base.orderByFields = opts.orderBy;
  if (opts.returnExtentOnly) base.returnExtentOnly = "true";
  if (opts.geometry) {
    base.geometry = opts.geometry;
    base.geometryType = opts.geometryType ?? "esriGeometryPoint";
    base.inSR = "4326";
    base.spatialRel = "esriSpatialRelIntersects";
    if (opts.distanceMiles !== undefined) {
      base.distance = String(opts.distanceMiles);
      base.units = "esriSRUnit_StatuteMile";
    } else if (opts.distanceMeters !== undefined) {
      base.distance = String(opts.distanceMeters);
      base.units = "esriSRUnit_Meter";
    }
  }
  const key = `${layerUrl}|${JSON.stringify(base)}|${max}|${pageSize}|${opts.offset ?? "all"}`;
  return cached(key, FREE_TTL_MS, async () => {
    if (opts.returnExtentOnly) {
      const json = await post(`${layerUrl}/query`, base, opts.timeoutMs);
      recordCall(opts.adapterId);
      const e = json.extent as Extent | undefined;
      const ok = e && [e.xmin, e.ymin, e.xmax, e.ymax].every((n) => typeof n === "number" && Number.isFinite(n));
      return { features: [], truncated: false, extent: ok ? e : null };
    }
    const features: Feature[] = [];
    let offset = opts.offset ?? 0;
    let truncated = false;
    for (;;) {
      const json = await post(`${layerUrl}/query`, {
        ...base,
        resultOffset: String(offset),
        resultRecordCount: String(Math.min(pageSize, max - features.length)),
      }, opts.timeoutMs);
      recordCall(opts.adapterId);
      const page = (json.features as Feature[] | undefined) ?? [];
      features.push(...page);
      const more = json.exceededTransferLimit === true;
      if (opts.offset !== undefined) {
        truncated = more;
        break;
      }
      if (!more || page.length === 0) break;
      if (features.length >= max) {
        truncated = true;
        break;
      }
      offset += page.length;
    }
    return { features, truncated };
  });
}

export async function countLayer(layerUrl: string, adapterId: string, where: string): Promise<number> {
  return cached(`${layerUrl}|count|${where}`, FREE_TTL_MS, async () => {
    const json = await post(`${layerUrl}/query`, { where, returnCountOnly: "true" });
    recordCall(adapterId);
    return Number(json.count ?? 0);
  });
}

/** When the publisher last changed the layer's data (ISO), if the service reports it. */
export async function layerDataDate(layerUrl: string, adapterId: string): Promise<string | null> {
  return cached(`${layerUrl}|meta`, 60 * 60 * 1000, async () => {
    try {
      const json = await post(layerUrl, {});
      recordCall(adapterId);
      const info = json.editingInfo as { dataLastEditDate?: number; lastEditDate?: number } | undefined;
      const ms = info?.dataLastEditDate ?? info?.lastEditDate;
      return ms ? new Date(ms).toISOString() : null;
    } catch {
      return null;
    }
  });
}

export function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Field names the layer currently publishes. Publishers rename fields without notice, so adapters check. */
export async function layerFields(layerUrl: string, adapterId: string): Promise<string[]> {
  return cached(`${layerUrl}|fields`, 15 * 60 * 1000, async () => {
    const json = await post(layerUrl, {});
    recordCall(adapterId);
    return ((json.fields as { name: string }[] | undefined) ?? []).map((f) => f.name);
  });
}
