// Runs one lookup for the tester artifact and writes the result as a JSON document.
//   npx tsx scripts/tester-lookup.ts "<address or parcel number>" <output.json>
// The query is treated purely as search text.

import { writeFileSync } from "node:fs";
import { buildReport, lookup } from "../src/lib/report";

async function main() {
  const [query, out] = process.argv.slice(2);
  if (!query || !out) throw new Error("usage: tester-lookup.ts <query> <output.json>");
  const finishedAt = () => new Date().toISOString();
  let doc: Record<string, unknown>;
  try {
    if (query.length > 200) throw new Error("Query too long.");
    const found = await lookup(query);
    if (found.kind === "one") {
      const report = await buildReport(found.folio);
      doc = report
        ? { status: "done", folio: found.folio, reportJson: JSON.stringify(report), finishedAt: finishedAt() }
        : { status: "none", message: "The property was found but its record could not be loaded.", finishedAt: finishedAt() };
    } else if (found.kind === "many") {
      doc = {
        status: "many",
        matches: found.matches.slice(0, 20).map((m) => ({
          id: m.folio,
          label: [m.address.value ?? "Unknown", m.unit.value ? `#${m.unit.value}` : null, m.city.value].filter(Boolean).join(" "),
          owner: m.owners.value?.[0] ?? null,
        })),
        finishedAt: finishedAt(),
      };
    } else {
      doc = {
        status: "none",
        message:
          found.kind === "none" && found.geocoded
            ? "The address was located on the map, but no parcel there has that house number and street."
            : "No Florida property matched. Check the house number and street, or paste the county's parcel number.",
        finishedAt: finishedAt(),
      };
    }
  } catch (e) {
    doc = {
      status: "error",
      message: `The data service did not answer (${e instanceof Error ? e.message.slice(0, 160) : "unknown error"}). Try again in a minute.`,
      finishedAt: finishedAt(),
    };
  }
  writeFileSync(out, JSON.stringify(doc));
  console.log(String(doc.status), doc.folio ?? doc.message ?? "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
