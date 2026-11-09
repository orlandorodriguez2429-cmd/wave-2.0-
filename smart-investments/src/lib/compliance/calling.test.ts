import { describe, expect, it } from "vitest";
import { attemptsInLast24h, canContact, isOptOutMessage, withinCallWindow, zonesForState, type ContactState } from "./calling";

const ET = ["America/New_York"];
// 11/09/2026 is in Eastern Standard Time (UTC-5).
const at = (hhmm: string) => new Date(`2026-11-09T${hhmm}:00-05:00`);

const clean: ContactState = {
  timeZones: ET,
  onDoNotCallList: false,
  optedOutAt: null,
  writtenConsentAt: null,
  attempts: [],
};

describe("calling window (8 am – 8 pm recipient time)", () => {
  it("allows 8:00 am and 7:59 pm, blocks 7:59 am and 8:00 pm", () => {
    expect(withinCallWindow(at("08:00"), ET)).toBe(true);
    expect(withinCallWindow(at("19:59"), ET)).toBe(true);
    expect(withinCallWindow(at("07:59"), ET)).toBe(false);
    expect(withinCallWindow(at("20:00"), ET)).toBe(false);
  });
  it("blocks 8:30 pm even though federal rules would allow it", () => {
    expect(canContact(clean, "manual_call", at("20:30")).allowed).toBe(false);
  });
  it("uses the recipient's zone, not ours", () => {
    // 10:30 am Eastern is 7:30 am Pacific.
    expect(withinCallWindow(at("10:30"), ["America/Los_Angeles"])).toBe(false);
    expect(withinCallWindow(at("11:00"), ["America/Los_Angeles"])).toBe(true);
  });
  it("must satisfy every possible zone when the exact one is unknown", () => {
    // Florida spans Eastern and Central: 8:30 am Eastern is 7:30 am Central.
    expect(withinCallWindow(at("08:30"), zonesForState("FL"))).toBe(false);
    expect(withinCallWindow(at("09:00"), zonesForState("FL"))).toBe(true);
    // Unknown state: only the hours valid from Puerto Rico to Hawaii remain.
    expect(withinCallWindow(at("09:00"), zonesForState(null))).toBe(false);
  });
});

describe("three attempts per 24 hours", () => {
  const now = at("15:00");
  const hoursAgo = (h: number) => ({ at: new Date(now.getTime() - h * 3600_000).toISOString(), channel: "manual_call" as const });
  it("counts only the last 24 hours", () => {
    expect(attemptsInLast24h([hoursAgo(1), hoursAgo(23), hoursAgo(25)], now)).toBe(2);
  });
  it("blocks the fourth attempt", () => {
    expect(canContact({ ...clean, attempts: [hoursAgo(1), hoursAgo(2)] }, "manual_call", now).allowed).toBe(true);
    const d = canContact({ ...clean, attempts: [hoursAgo(1), hoursAgo(2), hoursAgo(3)] }, "manual_call", now);
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/3 attempts/);
  });
});

describe("consent, opt-out and Do Not Call", () => {
  const now = at("12:00");
  it("blocks automated texts without written consent, allows a manual call", () => {
    expect(canContact(clean, "automated_text", now).allowed).toBe(false);
    expect(canContact(clean, "manual_call", now).allowed).toBe(true);
    expect(canContact({ ...clean, writtenConsentAt: "2026-11-01T00:00:00Z" }, "automated_text", now).allowed).toBe(true);
  });
  it("opt-out blocks everything, even with consent", () => {
    const d = canContact({ ...clean, writtenConsentAt: "2026-11-01T00:00:00Z", optedOutAt: "2026-11-08T00:00:00Z" }, "manual_call", now);
    expect(d.allowed).toBe(false);
  });
  it("blocks DNC numbers and numbers never checked", () => {
    expect(canContact({ ...clean, onDoNotCallList: true }, "manual_call", now).allowed).toBe(false);
    expect(canContact({ ...clean, onDoNotCallList: null }, "manual_call", now).allowed).toBe(false);
  });
  it("recognizes opt-out messages in English and Spanish", () => {
    for (const m of ["STOP", "stop texting me", "Please remove me", "do not call again", "PARAR", "no me llame más", "No molesten", "ALTO"]) {
      expect(isOptOutMessage(m), m).toBe(true);
    }
    for (const m of ["Yes I'm interested", "Call me tomorrow", "¿Cuánto ofrece?"]) {
      expect(isOptOutMessage(m), m).toBe(false);
    }
  });
});
