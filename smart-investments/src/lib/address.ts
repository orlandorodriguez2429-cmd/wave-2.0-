// Turns what a person types ("1234 West 32nd Way, Hialeah, FL 33018") into the
// form the county uses ("1234 W 32 WAY"), and recognizes folio numbers.

const DIRECTIONS: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

const SUFFIXES: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  COURT: "CT",
  TERRACE: "TER",
  TERR: "TER",
  PLACE: "PL",
  LANE: "LN",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  HIGHWAY: "HWY",
  PARKWAY: "PKWY",
  TRAIL: "TRL",
  SQUARE: "SQ",
};

const UNIT_WORDS = new Set(["APT", "APARTMENT", "UNIT", "STE", "SUITE", "#"]);

export type ParsedQuery =
  | { kind: "folio"; folio: string }
  | { kind: "address"; street: string; tokens: string[]; unit: string | null; zip: string | null; raw: string }
  | { kind: "empty" };

export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim();
  if (!raw) return { kind: "empty" };

  const digits = raw.replace(/[\s-]/g, "");
  if (/^\d{13}$/.test(digits)) return { kind: "folio", folio: digits };

  let text = raw.toUpperCase().replace(/[.]/g, "");
  const zipMatch = text.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  const zip = zipMatch ? zipMatch[1] : null;
  if (zipMatch) text = text.slice(0, zipMatch.index).trim();

  // Keep only the street part when the person typed "street, city, state".
  const firstPart = text.split(",")[0].trim();
  let words = firstPart.replace(/#\s*/g, " # ").split(/\s+/).filter(Boolean);

  let unit: string | null = null;
  const unitIdx = words.findIndex((w) => UNIT_WORDS.has(w));
  if (unitIdx > 0) {
    unit = words[unitIdx + 1] ?? null;
    words = words.slice(0, unitIdx);
  }

  const tokens = words.map((w, i) => {
    const ordinal = w.match(/^(\d+)(ST|ND|RD|TH)$/);
    if (ordinal) return ordinal[1];
    if (DIRECTIONS[w]) return DIRECTIONS[w];
    // Only shorten a suffix word when it is not the street's own name ("COURT ST" is rare; position > 1 is safe).
    if (i > 1 && SUFFIXES[w]) return SUFFIXES[w];
    return w;
  });

  // Without commas, a trailing "FL" / "FLORIDA" is state noise.
  while (tokens.length > 2 && ["FL", "FLORIDA"].includes(tokens[tokens.length - 1])) tokens.pop();

  return { kind: "address", street: tokens.join(" "), tokens, unit, zip, raw };
}

/**
 * Candidate street strings to try, longest first. Dropping trailing words handles
 * "123 W 49 ST HIALEAH" typed without a comma.
 */
export function streetCandidates(tokens: string[]): string[] {
  const out: string[] = [];
  for (let n = tokens.length; n >= Math.min(3, tokens.length); n--) {
    out.push(tokens.slice(0, n).join(" "));
  }
  return out;
}

/** Loose comparison key for "is the mailing address the same place as the property?" */
export function addressKey(address: string | null): string | null {
  if (!address) return null;
  const parsed = parseQuery(address);
  if (parsed.kind !== "address") return null;
  return parsed.tokens.join(" ");
}

export function formatFolio(folio: string): string {
  return /^\d{13}$/.test(folio)
    ? `${folio.slice(0, 2)}-${folio.slice(2, 6)}-${folio.slice(6, 9)}-${folio.slice(9)}`
    : folio;
}
