// Live check against real Miami-Dade records: `npm run check:addresses -- "address 1" "address 2"`.
// Prints what the Deal Report would show, with source and data date, so results can be
// compared by hand against the Property Appraiser's website.

import { buildReport, lookup } from "../src/lib/report";
import { fmtDate, fmtMoney } from "../src/lib/sourced";

const DEFAULTS = ["10236 West 32nd Way, Hialeah, FL 33018", "10717 SW 240 Terrace, Miami, FL", "30-3127-001-0820"];

async function main() {
  const inputs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULTS;
  for (const input of inputs) {
    console.log(`\n=== ${input}`);
    const t0 = Date.now();
    const found = await lookup(input);
    if (found.kind === "many") {
      console.log(`  ${found.matches.length} matches:`);
      for (const m of found.matches.slice(0, 8)) console.log(`   - ${m.folio} ${m.address.value} ${m.unit.value ?? ""} ${m.city.value}`);
      continue;
    }
    if (found.kind !== "one") {
      console.log(`  No match (${JSON.stringify(found)})`);
      continue;
    }
    const r = await buildReport(found.folio);
    if (!r) {
      console.log("  Folio not found");
      continue;
    }
    const p = r.property;
    console.log(`  Folio ${p.folio} | ${p.address.value} ${p.unit.value ?? ""}, ${p.city.value} ${p.zip.value}`);
    console.log(`  Source: ${p.address.source}, updated ${fmtDate(p.address.asOf)}`);
    console.log(`  Owner: ${p.owners.value?.join(" & ") ?? "Unknown"} (${r.owner.kind})`);
    console.log(`  Mailing: ${p.mailingAddress.value}, ${p.mailingCity.value} ${p.mailingState.value} ${p.mailingZip.value}`);
    console.log(`  Absentee: ${r.owner.absentee} | Out of state: ${r.owner.outOfState} | Years since transfer: ${r.owner.yearsSinceTransfer}`);
    console.log(`  ${p.useDescription.value} | ${p.beds.value ?? "?"} bd / ${p.baths.value ?? "?"} ba | ${p.heatedSqft.value ?? "?"} sqft | lot ${p.lotSqft.value ?? "?"} | built ${p.yearBuilt.value ?? "?"}`);
    console.log(`  Assessed ${fmtMoney(p.assessedValue.value)} (${p.assessmentYear.value}) | Last transfer ${fmtDate(p.lastTransferDate.value)} for ${fmtMoney(p.lastTransferPrice.value)}`);
    console.log(`  Violations covered by county data: ${r.violationsCovered} | cases on file: ${r.signals.length} (${r.signals.filter((s) => s.open).length} open)`);
    for (const s of r.signals.slice(0, 5)) console.log(`   - [${s.open ? "OPEN" : "closed"}] ${s.type}: ${s.description} ${fmtDate(s.openedAt)} (#${s.caseNumber})`);
    console.log(`  Motivation score: ${r.score.score}`);
    for (const reason of r.score.reasons) console.log(`   +${reason.points} ${reason.label}`);
    if (r.value) {
      console.log(`  Value estimate (${r.compTierLabel}, ${r.value.compCount} comps, ${r.value.confidence} confidence): ${fmtMoney(r.value.low)} / ${fmtMoney(r.value.likely)} / ${fmtMoney(r.value.high)}`);
      for (const c of r.comps.slice(0, 5)) console.log(`   - ${c.address} ${fmtDate(c.saleDate)} ${fmtMoney(c.price)} ${c.heatedSqft ?? "?"} sqft ${c.distanceMiles?.toFixed(2)} mi`);
    } else {
      console.log("  Value estimate: Unknown (no usable comps)");
    }
    console.log(`  Approach angle: ${r.approach.angleKey}`);
    console.log(`  Total time: ${Date.now() - t0} ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
