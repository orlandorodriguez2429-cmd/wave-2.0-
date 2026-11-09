// LOCAL TEST STORAGE ONLY. Saves the pipeline to a JSON file on this machine so the
// app can be tried end to end before a Supabase project exists. It has no login, no
// row-level security and does not work on Vercel (read-only disk). The `leads` and
// `activities` tables in supabase/migrations replace it.

import { promises as fs } from "node:fs";
import path from "node:path";

export const STAGES = [
  "New Lead",
  "Skip Traced",
  "Contacted",
  "Conversation",
  "Appointment",
  "Offer Sent",
  "Under Contract",
  "Marketed to Buyers",
  "Assigned/Closed",
  "Nurture",
  "Dead",
] as const;
export type Stage = (typeof STAGES)[number];

export interface SavedNote {
  at: string;
  text: string;
}

export interface SavedLead {
  folio: string;
  address: string;
  city: string | null;
  owner: string | null;
  score: number;
  reasons: string[];
  stage: Stage;
  hat: "investor" | "agent";
  notes: SavedNote[];
  savedAt: string;
  updatedAt: string;
}

const FILE = path.join(process.cwd(), ".data", "pipeline.json");

async function readAll(): Promise<SavedLead[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as SavedLead[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeAll(leads: SavedLead[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(leads, null, 2));
  await fs.rename(tmp, FILE);
}

export async function listLeads(): Promise<SavedLead[]> {
  return (await readAll()).sort((a, b) => b.score - a.score);
}

export async function getLead(folio: string): Promise<SavedLead | null> {
  return (await readAll()).find((l) => l.folio === folio) ?? null;
}

export async function saveLead(input: Omit<SavedLead, "stage" | "hat" | "notes" | "savedAt" | "updatedAt">): Promise<void> {
  const all = await readAll();
  const now = new Date().toISOString();
  const existing = all.find((l) => l.folio === input.folio);
  if (existing) {
    Object.assign(existing, input, { updatedAt: now });
  } else {
    all.push({ ...input, stage: "New Lead", hat: "investor", notes: [], savedAt: now, updatedAt: now });
  }
  await writeAll(all);
}

export async function updateLead(folio: string, change: { stage?: Stage; hat?: "investor" | "agent"; note?: string }): Promise<void> {
  const all = await readAll();
  const lead = all.find((l) => l.folio === folio);
  if (!lead) return;
  const now = new Date().toISOString();
  if (change.stage && (STAGES as readonly string[]).includes(change.stage)) lead.stage = change.stage;
  if (change.hat === "investor" || change.hat === "agent") lead.hat = change.hat;
  if (change.note?.trim()) lead.notes.unshift({ at: now, text: change.note.trim().slice(0, 2000) });
  lead.updatedAt = now;
  await writeAll(all);
}

export async function removeLead(folio: string): Promise<void> {
  await writeAll((await readAll()).filter((l) => l.folio !== folio));
}
