// Outreach guardrails. These are coded limits, not legal advice; the rules must be
// confirmed with a Florida attorney and the broker before any calling or texting starts.
//
// Rules implemented (Florida Telephone Solicitation Act + federal TCPA, as researched 11/09/2026):
//  - Calls and texts only between 8:00 am and 8:00 pm in the RECIPIENT's local time
//    (Florida is stricter than the federal 9 pm).
//  - No more than 3 contact attempts to the same person on the same subject in any 24 hours,
//    counted across all of that person's phone numbers.
//  - An opt-out (STOP, "do not call", etc.) blocks every channel immediately and permanently.
//  - Numbers on a Do Not Call list are blocked.
//  - Automated texts or auto-dialed calls need prior express written consent on file.
//    A number found by skip tracing is never consent.

export const CALL_WINDOW_START_HOUR = 8;
export const CALL_WINDOW_END_HOUR = 20;
export const MAX_ATTEMPTS_PER_24H = 3;

export type Channel = "manual_call" | "manual_text" | "automated_call" | "automated_text" | "voicemail_drop";

export interface ContactAttempt {
  at: string; // ISO timestamp
  channel: Channel;
}

export interface ContactState {
  /** IANA time zone of the recipient. If unknown, pass every zone they might be in. */
  timeZones: string[];
  onDoNotCallList: boolean | null;
  optedOutAt: string | null;
  writtenConsentAt: string | null;
  /** Attempts to this PERSON (all their numbers) about this property/subject. */
  attempts: ContactAttempt[];
}

export interface ComplianceDecision {
  allowed: boolean;
  reasons: string[];
}

/** Time zones a U.S. state spans. Only states whose owners we commonly see; others must be supplied. */
const STATE_ZONES: Record<string, string[]> = {
  FL: ["America/New_York", "America/Chicago"],
  NY: ["America/New_York"],
  NJ: ["America/New_York"],
  GA: ["America/New_York"],
  NC: ["America/New_York"],
  PA: ["America/New_York"],
  MA: ["America/New_York"],
  TX: ["America/Chicago", "America/Denver"],
  IL: ["America/Chicago"],
  CA: ["America/Los_Angeles"],
  PR: ["America/Puerto_Rico"],
};

const ALL_US_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
];

/** Unknown state means we must satisfy the window in every U.S. zone. */
export function zonesForState(state: string | null): string[] {
  if (!state) return ALL_US_ZONES;
  return STATE_ZONES[state.toUpperCase()] ?? ALL_US_ZONES;
}

export function localHour(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h + m / 60;
}

export function withinCallWindow(at: Date, timeZones: string[]): boolean {
  if (timeZones.length === 0) return false;
  return timeZones.every((tz) => {
    const h = localHour(at, tz);
    return h >= CALL_WINDOW_START_HOUR && h < CALL_WINDOW_END_HOUR;
  });
}

export function attemptsInLast24h(attempts: ContactAttempt[], now: Date): number {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return attempts.filter((a) => {
    const t = new Date(a.at).getTime();
    return t > cutoff && t <= now.getTime();
  }).length;
}

export function canContact(state: ContactState, channel: Channel, now: Date = new Date()): ComplianceDecision {
  const reasons: string[] = [];

  if (state.optedOutAt) reasons.push("This person opted out. No calls, texts or voicemail, on any number.");
  if (state.onDoNotCallList === true) reasons.push("Number is on a Do Not Call list.");
  if (state.onDoNotCallList === null) reasons.push("Do Not Call status has not been checked for this number.");

  if (!withinCallWindow(now, state.timeZones)) {
    reasons.push("Outside 8:00 am – 8:00 pm in the recipient's local time.");
  }
  if (attemptsInLast24h(state.attempts, now) >= MAX_ATTEMPTS_PER_24H) {
    reasons.push("Already 3 attempts to this person in the last 24 hours.");
  }

  const automated = channel === "automated_call" || channel === "automated_text" || channel === "voicemail_drop";
  if (automated && !state.writtenConsentAt) {
    reasons.push("Automated calls, texts and voicemail drops need prior express written consent on file.");
  }

  return { allowed: reasons.length === 0, reasons };
}

const OPT_OUT_PATTERNS = [
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bremove me\b/i,
  /\bdo not (call|text|contact)\b/i,
  /\bdon'?t (call|text|contact)\b/i,
  /\bquit\b/i,
  /\bcancel\b/i,
  /\bend\b/i,
  // Spanish
  /\bparar\b/i,
  /\balto\b/i,
  /\bno (me )?(llame|llamen|llames|escriba|escriban|contacte|contacten)\b/i,
  /\bno molest(e|en|ar)\b/i,
  /\bb[aá]ja\b/i,
];

/** True when an inbound message asks us to stop, in English or Spanish. Errs toward honoring it. */
export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERNS.some((re) => re.test(text));
}
