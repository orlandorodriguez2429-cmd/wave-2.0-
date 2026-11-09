// Pipeline form posts for the local test store (see src/lib/store.ts).
// Plain form posts are used instead of Server Actions so they also work behind
// forwarded preview hosts. Replace with authenticated Supabase writes later.

import { buildReport, isPropertyId } from "@/lib/report";
import { removeLead, saveLead, updateLead, type Stage } from "@/lib/store";

function back(to: string): Response {
  return new Response(null, { status: 303, headers: { Location: to } });
}

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const folio = String(form.get("folio") ?? "");
  if (!isPropertyId(folio)) return new Response("Bad folio", { status: 400 });
  const action = String(form.get("_action") ?? "");

  if (action === "save") {
    // Rebuild from the source rather than trusting values posted by the browser.
    const report = await buildReport(folio);
    if (!report) return new Response("Property not found", { status: 404 });
    const p = report.property;
    await saveLead({
      folio,
      address: [p.address.value ?? "Unknown", p.unit.value ? `#${p.unit.value}` : null].filter(Boolean).join(" "),
      city: p.city.value,
      owner: p.owners.value?.join(" & ") ?? null,
      score: report.score.score,
      reasons: report.score.reasons.map((r) => `+${r.points} ${r.label}`),
    });
  } else if (action === "update") {
    const stage = form.get("stage");
    const hat = form.get("hat");
    const note = form.get("note");
    await updateLead(folio, {
      stage: typeof stage === "string" ? (stage as Stage) : undefined,
      hat: hat === "investor" || hat === "agent" ? hat : undefined,
      note: typeof note === "string" ? note : undefined,
    });
  } else if (action === "remove") {
    await removeLead(folio);
  } else {
    return new Response("Unknown action", { status: 400 });
  }
  return back("/pipeline");
}
