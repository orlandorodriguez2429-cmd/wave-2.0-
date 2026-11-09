import type { ReactNode } from "react";
import { fmtDate, type Sourced } from "@/lib/sourced";

/** The small "i" that shows where a number came from and how fresh it is. */
export function Src({ source, asOf, note, estimate }: { source: string; asOf?: string | null; note?: string; estimate?: boolean }) {
  return (
    <span className="src" tabIndex={0} aria-label={`Source: ${source}`}>
      i
      <span className="tip" role="tooltip">
        <strong>{estimate ? "Estimate" : "Source"}:</strong> {source}
        {asOf ? <>, updated {fmtDate(asOf)}</> : null}
        {note ? (
          <>
            <br />
            {note}
          </>
        ) : null}
      </span>
    </span>
  );
}

/** Renders a sourced value, or "Unknown" when the source has nothing. */
export function Val<T>({
  s,
  format,
  unknown = "Unknown",
}: {
  s: Sourced<T>;
  format?: (v: T) => ReactNode;
  unknown?: string;
}) {
  return (
    <span className="num">
      {s.value === null ? <span className="muted">{unknown}</span> : format ? format(s.value) : String(s.value)}
      <Src source={s.source} asOf={s.asOf} note={s.note} />
    </span>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="text-[15px] font-medium">{children}</div>
    </div>
  );
}

export function scoreTone(score: number): "bad" | "warn" | "good" | "muted" {
  if (score >= 40) return "bad"; // hottest
  if (score >= 20) return "warn";
  if (score > 0) return "good";
  return "muted";
}

export function ScoreRing({ score, size = 92 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  const color = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : tone === "good" ? "var(--good)" : "var(--muted)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`Motivation score ${score} of 100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold num leading-none">{score}</span>
        <span className="text-[10px] muted">/ 100</span>
      </div>
    </div>
  );
}

export const TYPE_LABEL: Record<string, string> = {
  single_family: "Single-family",
  condo: "Condo",
  townhouse: "Townhouse",
  duplex: "Duplex",
  multifamily_small: "Multifamily 3+",
  multifamily_large: "Multifamily 10+",
  coop: "Co-op",
  vacant_land: "Vacant land",
  other: "Other",
};
