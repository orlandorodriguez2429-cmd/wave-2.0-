// Every value shown on screen carries where it came from and how fresh it is.
// A null value means "Unknown" — the UI never substitutes a guess.

export type Confidence = "high" | "medium" | "low" | "estimate";

export interface Sourced<T> {
  value: T | null;
  /** Human-readable source, e.g. "Miami-Dade Property Appraiser (Property Point View)". */
  source: string;
  /** When the source says its data was last updated (ISO date), if it tells us. */
  asOf: string | null;
  /** When we fetched it (ISO timestamp). */
  fetchedAt: string;
  confidence: Confidence;
  note?: string;
}

export function sourced<T>(
  value: T | null | undefined,
  meta: { source: string; asOf?: string | null; fetchedAt: string; confidence?: Confidence; note?: string },
): Sourced<T> {
  return {
    value: value === undefined ? null : value,
    source: meta.source,
    asOf: meta.asOf ?? null,
    fetchedAt: meta.fetchedAt,
    confidence: meta.confidence ?? "high",
    note: meta.note,
  };
}

/** MM/DD/YYYY, the format used across the app. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unknown";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unknown";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "Unknown";
  return Math.round(n).toLocaleString("en-US");
}
