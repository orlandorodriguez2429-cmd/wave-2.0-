# Smart Investments Today v2 — Phase 0 Research Report

Researched 11/09/2026. Status: **waiting for your approval of the feature list (section 6) and answers to the questions in section 8.**

How to read this report:

- **Confirmed** = found in a search result this session (source linked). Most sources are secondary (vendor pages, law-firm alerts, review sites).
- **Not verified** = I could not confirm it this session. Treat it as a lead, not a fact.
- **Background** = from my own general knowledge of the industry, not checked against a transcript or official page this session.
- Official government sites (floridarevenue.com, flsenate.gov, leg.state.fl.us, miamidadepa.gov, miamidadeclerk.gov, bcpa.net) are **blocked by this session's network settings**, so I could not open the primary pages. Everything about them below comes from search-result summaries. Before Phase 1 they need to be allowed so I can check formats and download sample files.

---

## 1. Blocker: this repository is not Smart Investments Today

The repo I was started in (`wave-2.0-`) is a different app:

| | What the prompt expects | What is actually here |
|---|---|---|
| App | Smart Investments Today (real estate) | "Wave 2.0" small-business accounting (ledger, invoicing, bank feeds, W-9/1099) |
| Database | Supabase | Plain PostgreSQL through Prisma 7 |
| Hosting | Vercel | Docker / docker-compose |
| Real-estate code | Existing features to preserve | None. No property, lead, owner or map code anywhere |

What exists here (for the record): Next.js 15 App Router + TypeScript + Tailwind 4, Prisma schema with 7 migrations, double-entry ledger, invoices/estimates/expenses, bank import and reconciliation, W-9 collection, 1099 generation and pluggable e-file, reports, auth with roles, multi-entity, close-the-books checklist, small REST API with webhooks, pdfkit PDFs, 59 Vitest tests.

This is the only repository my GitHub access can see. I have **not** changed any accounting code. The only thing added is this file, on the branch `claude/great-knuth-937kg5`.

You need to choose one (question 1 in section 8):

1. Give this session access to the real Smart Investments Today repo, and I restart from "read the codebase".
2. Smart Investments Today has no code yet, and you want it built fresh (new repo recommended; Supabase + Vercel as you described).
3. Build it inside this repo next to the accounting app (I do not recommend this: different product, different database setup).

Parts of this accounting app are reusable either way: auth and roles, the audit log, PDF generation, the encrypted-field helper, and the pluggable-provider pattern used for bank feeds and e-file (the same shape as the `DataAdapter` idea).

---

## 2. Things in the master prompt that the research says to change

| # | Prompt says | Research found | Effect on the build |
|---|---|---|---|
| 1 | Calls/texts allowed 8am–9pm | Florida is stricter than federal: **8am–8pm** recipient local time. Also **max 3 calls per 24 hours** to the same person on the same subject, whatever number you call from. (Confirmed via 2021 bill text/analysis and several compliance guides; current statute text not opened.) | Guardrail = 8am–8pm and a 3-per-24h counter per person, not per phone number |
| 2 | Miami-Dade PA bulk CSVs are free | The PA bulk download site charges **$50 per file** (credits), files refreshed about weekly. (Confirmed, search summary of bbs.miamidadepa.gov.) | Tier 0 is not fully free if we want weekly PA files. Free route: FL DOR NAL/SDF (yearly) + county ArcGIS open data layers |
| 3 | Clerk records in the free tier | Miami-Dade Clerk sells bulk data: FTP **$80/folder/month, listed as $110 from 10/01/2025**; API **$0.05 per request** prepaid. Which folder carries lis pendens is not confirmed. | Lis pendens for Miami-Dade is a paid line item (roughly $110+/mo) or comes through a paid platform |
| 4 | County code-violation data covers the county | County code-compliance datasets cover **unincorporated** areas. Cities run their own code enforcement. **Hialeah is a city**, so Hialeah violations are probably not in the county dataset. (Confirmed for Miami-Dade dataset description, Broward and Palm Beach.) | Each city needs its own source or a public-records request. I need to check what Hialeah, Miami, Miami Gardens, Fort Lauderdale etc. publish |
| 5 | Federal opt-out within 10 business days | The 10-business-day rule: background, not confirmed this session. Confirmed: the FCC "revoke-all" rule (one STOP ends all messages from the sender) is **delayed to 01/31/2027**. Florida's FTSA gives a 15-day window after a STOP reply before a text claim can be brought. | No change: we honor opt-outs instantly and apply them to every channel, which satisfies all versions |
| 6 | MLS feed for on-market deals and comps | Miami Realtors gives members **one courtesy IDX feed** (agents via Bridge API, brokers via Trestle); extra feeds $1,000 each. IDX is a *display* license with its own rules. Whether it allows private back-office analysis, sold data, or resale inside a future product is **not verified**. | Needs your broker's approval and a look at the license before Module 3. A sellable product cannot ride on your personal IDX feed |

---

## 3. Feature research — paid platforms

Prices are list prices from 2026 review sites and vendor news pages unless marked.

| Platform | Monthly price | What it is best at | Ideas to take |
|---|---|---|---|
| PropStream | $99 Essentials / $199 Pro / $699 Elite. Skip tracing from $0.12 on Essentials, bundled on Pro/Elite. Exports 25k/50k/100k | Nationwide property data, 100+ filters, prebuilt lead lists, comps | Quick lists, filter stacking, list automation (new matches added automatically) |
| BatchLeads | Tiered, exact prices not confirmed; 40% off annual | List building, list stacking, SMS/calling volume | Stacked-list count shown per property, built-in skip trace |
| DealMachine | Not confirmed | Driving for dollars: tap-to-add, route tracking, virtual driving, dialer | One-tap D4D pin with photo, driven-route overlay so you never drive a street twice |
| PropertyRadar | $119 Solo / $249 for 3 users | Deep public-record data, owner lookups, triggers | Change alerts on saved lists ("something new happened") |
| REsimpli | Not confirmed; 30-day trial | All-in-one data + CRM + dialer + KPIs | KPI dashboard by list source, drip follow-up, accounting of marketing spend |
| DealCheck | Free / $10–14 Plus / $20–29 Pro | Deal analysis for flip, BRRRR, rental; clean reports | Side-by-side strategies, offer calculator that works backward from target profit, shareable report |
| RentCast | Free 50 calls/mo; Foundation $74, Growth $199, Scale $449 (**from a coupon site, not verified**) | Rent estimates, AVM, comps, listings by API | Our main Tier 1 adapter candidate |
| Mashvisor | $40–$100 billed annually | Short-term vs long-term rental comparison, heatmaps | Zip heatmaps by strategy |
| Privy | From ~$78 one market (not verified) | Finding on-market deals by watching what investors actually buy | "Investor activity" layer: recent flips and their buy/sell spread per neighborhood |
| InvestorLift | Not found | Dispositions: buyer database, buyer matching, deal marketplace | Buyer ranking by past purchases, deal page with view/offer tracking (background) |
| Carrot | From ~$49 (not verified) | SEO seller websites with lead forms | Bilingual "sell my house" landing page feeding our CRM |
| Podio-style REI CRMs | Varies | Custom pipelines and automations | Stage-based task automation (background) |
| Zillow / Redfin | Free to consumers | Listings UX, price history | UX ideas only. No scraping; their terms forbid automated access |

---

## 4. Creator playbooks → modules

Honest note: searches confirmed only parts of these. Items marked **(background)** are my summary of widely taught industry practice, not pulled from a specific video or transcript this session. In Phase 10 each playbook page should link the actual source video before we present it as "what X teaches".

**List stacking** (REsimpli, DealMachine, BatchLeads guides — confirmed) → Module 2
- Compare separate distress lists; a property on two or more is far more likely to sell.
- Typical strong stack: poor condition + tax delinquent + absentee.
- Main signal families: financial distress, owner fatigue, equity, vacancy.
- Track results by list and by overlap combination; vendor conversion claims are marketing until we measure our own.

**Driving for dollars** (DealMachine — partly confirmed) → Module 2, mobile
- Look for visible neglect: overgrown yard, boarded windows, tarps, notices on the door, piled mail (background).
- Capture in one tap, then stack the pin against the other lists.
- Record routes so streets are not repeated.

**Cold calling, Brent Daniels "TTP"** (confirmed: four pillars and targets; script wording not obtained) → Module 5
- Pre-qualify every conversation on four pillars: **condition, timeline, motivation, price**.
- Activity target he gives: about 15 owner contacts per hour, about 1 qualified lead per hour.
- Only negotiate face to face after all four pillars are answered.
- Our lead form gets those four fields, and a lead cannot move to "Appointment" until they are filled.

**Wholesale MAO** (background, standard formula) → Module 4
- MAO = ARV × 70% − repairs − assignment fee.
- The percentage moves with the market and price point (65–80%).
- Always present three numbers: opening, target, walk-away.

**ARV / comps** (background; could not confirm Jamil Damji's specific rules) → Module 4
- Same property type, similar size (about ±20% sq ft), similar age, same subdivision where possible.
- Do not cross major roads, canals or school-zone lines for comps.
- Sold in the last 6 months, widen only when needed and lower the confidence when you do.
- Use renovated solds for ARV and as-is solds for current value; never use active listings as comps.

**Creative finance, Pace Morby** (partly confirmed via BiggerPockets) → Module 4
- Subject-to: buyer takes title, the seller's loan stays in place, buyer makes the payments. Fits low-rate loans with little equity.
- Seller finance: fits free-and-clear or high-equity owners; you negotiate against their equity.
- He says the market decides the mix (he moved from mostly sub-to to mostly seller finance).
- Due-on-sale risk exists on every subject-to deal. Our report must state it, and these contracts go through your attorney.

**BRRRR** (background, BiggerPockets) → Module 4
- Buy, rehab, rent, refinance, repeat.
- Test: all-in cost ≤ about 75% of ARV to pull most cash back out.
- Check cash flow and DSCR after the refinance, at today's rate, not before.

**Rehab estimating** (background) → Module 4
- Price by condition tier per sq ft, then add big-ticket items separately (roof, HVAC, impact windows, electrical panel, plumbing, permits).
- South Florida defaults should be yours to set; I will not invent local prices.

**"Day Zero" on-market hunting** (could not confirm the source material) → Module 3
- Idea (background): analyze new listings the day they hit and offer before other investors.
- Needs a real-time listing feed, so it depends on the MLS question.

**Dispositions / buyers list** (background) → Module 6
- Best buyers are people who bought nearby, for cash, recently. County sales data shows this.
- Match on area, type, price and strategy; send to the best matches first.

**Expired / FSBO prospecting, listing presentations** (background) → Module 7
- Expireds and FSBOs are owners who already raised their hand. Agent hat, not investor hat.
- Note: calling expireds still falls under DNC and the Florida calling rules.

---

## 5. Data sources

### 5.1 Statewide

| Source | Status | Format / frequency | Cost | Notes |
|---|---|---|---|---|
| FL DOR NAL (parcels, owner, values), SDF (sales), NAP | Confirmed. 2026 user guide published; preliminary rolls due 07/01/2026, final rolls October 2026 | CSV with header row, one file per county, **yearly** (preliminary + final) | Free | Field layout can change each year. Good base layer for all 67 counties, but up to a year stale for ownership and sales |
| DOR GIS parcel shapefiles | Confirmed | Shapefile, collected each April, statewide linework updated each July | Free | |
| Statewide parcel ArcGIS service (FGIO) | Confirmed: about 10.8M parcels, has owner name, 2,000 records per request | REST / paged | Free (terms not verified) | Alternative to file downloads |
| FEMA flood zones, HUD FMR, Census/ACS, FRED rates | Background: all have free official APIs | API | Free | Not re-checked this session |
| Sunbiz (LLC officers) | Background: free search and bulk data files | Not verified | Free | Format to be checked |
| DBPR condo SIRS reporting database | Confirmed: public, shows forms as filed | Web database | Free | Automated access not verified |
| Milestone inspection status | Confirmed **incomplete**: state auditors (OPPAGA report 26-04, July 2026) found only 250–277 of 389 jurisdictions reported | — | — | Cannot be a reliable statewide signal. Show "Unknown" unless the county publishes it |
| School ratings | Not researched | | | |

### 5.2 By county

| Data | Miami-Dade | Broward | Palm Beach |
|---|---|---|---|
| Property Appraiser bulk | **$50 per file**, CSV, about weekly (parcels, sales, buildings). Custom extracts quoted | Data is **sold**; price list not found | No bulk download page found; request through PAO public services / GIS |
| Free parcel layer | County open data hub has property point/boundary layers (fields not verified) | County GIS hub says parcel and tax roll data "can be purchased" | County ArcGIS parcel service exists |
| Recorded documents (lis pendens, liens, deeds) | Clerk FTP $80→$110/folder/month; API $0.05/request. Lis pendens folder not confirmed | County Records, Taxes & Treasury publishes Official Records by FTP: index + images, rolling 10 days. Appears free | Clerk FTP, subscription by signed agreement and check. Price not found |
| Court cases (foreclosure, probate, evictions, divorce) | Same Clerk developer program; details not verified | Clerk Commercial Data Access API, needs a notarized agreement. Price not found | Not found |
| Code violations | County ArcGIS: open building violations, code compliance violations, violation liens; listed as daily. **Unincorporated only** | County system covers unincorporated Broward only (under 1% of residents) | Fee-based certified searches, unincorporated only |
| Building permits | County open data (not verified in detail) | Online permit system, no bulk source found | Permit activity reports listed; format not verified |
| Foreclosure auctions / tax deeds (RealForeclose, RealTaxDeed) | **Terms of use not found.** I will not automate these until the terms or the clerk say it is allowed | same | same |
| Tax delinquency / certificates | Not researched yet | Not researched yet | Not researched yet |

Privacy note (background): Florida law lets certain owners (police, judges and others) have their records hidden. Public files already exclude them. We must never try to fill those gaps.

### 5.3 What this means for the tier menu

A realistic low-cost Phase 1 for Miami-Dade:

- **$0:** DOR NAL + SDF (owner, values, sales, yearly) + county ArcGIS violation layers (daily, unincorporated only) + FEMA/HUD/FRED + RentCast free tier (50 calls/month).
- **About $50–$100/month extra:** one Miami-Dade PA file per month for fresher ownership and sales.
- **About $110+/month extra:** Miami-Dade Clerk folder for lis pendens, once I confirm which folder.
- Compare with PropStream Essentials at $99/month, which already includes pre-foreclosure, liens and vacancy flags nationwide and allows exports. For a two-person team, **importing PropStream exports may be cheaper than buying county clerk feeds one by one**. Whether their terms allow loading exports into our own app, and later a product we sell, is not verified.

Skip tracing (vendor-reported): Tracerfy $0.02 per match to $0.10 per delivered record; BatchData API $0.01–$0.05 per match at volume; PropStream $0.12. DNC and litigator scrub pricing not found.

---

## 6. Feature matrix — please approve, cut or reorder

Priority: P1 = build in phases 1–4, P2 = phases 5–7, P3 = phases 8–9.

| Feature | Who has it | Build? | Priority | Depends on |
|---|---|---|---|---|
| Parcel + owner + sales database (county + folio key) | PropStream, PropertyRadar | Yes | P1 | DOR files; PA files optional |
| Source + date + confidence on every field | Nobody does this well | Yes | P1 | — |
| Adapter system with usage and cost page | — | Yes | P1 | — |
| 30-day cache of paid calls | — | Yes | P1 | — |
| Absentee / out-of-state / LLC / years-owned flags | All list tools | Yes | P1 | Parcel data |
| Equity estimate (labeled estimate) | PropStream, BatchLeads | Yes | P1 | Sales + recorded mortgages; low confidence without mortgage data |
| Code violation signals | PropStream, PropertyRadar | Yes, unincorporated first | P1 | City sources for Hialeah etc. |
| Lis pendens / pre-foreclosure | All | Yes | P1 | Paid clerk feed or platform import |
| Property Analyzer, all exit strategies side by side | DealCheck | Yes | P1 | Comps source |
| Live-adjustable comps and ARV range | DealCheck, PropStream | Yes | P1 | Sales data; listings improve it |
| Repair estimator, quick + detailed | DealCheck | Yes | P1 | Your default prices |
| Florida gotchas block (tax reset, flood, wind, condo, permits, doc stamps) | Nobody | Yes | P1 | See section 7 |
| Branded PDF + share link | DealCheck | Yes | P1 | — |
| Motivation score with reasons and editable weights | BatchLeads, REsimpli | Yes | P1 | Signals above |
| List stacking | BatchLeads, REsimpli | Yes | P1 | — |
| Buy-box filters, saved searches, daily alerts | All | Yes | P1 | — |
| Map with clusters and zip heatmap | All | Yes | P1 | Geocoding |
| Driving-for-dollars pins (photo, GPS, notes) | DealMachine | Yes | P1 | Mobile web first |
| Driven-route tracking | DealMachine | Later | P3 | — |
| CRM pipeline, tasks, timeline, partner assignment | REsimpli, Podio | Yes | P1 | — |
| Compliance guardrails (hours, 3-call cap, DNC, consent log, instant opt-out) | Partial in dialers | Yes | P1 | DNC data source |
| Scripts and letters EN/ES with mail-merge | REsimpli (EN only) | Yes | P1 | — |
| Skip tracing adapter | All | Yes | P1 | Vendor choice |
| Built-in dialer / SMS sending | BatchLeads, REsimpli | Not at first: log calls made on your phone; add a compliant provider later | P2 | Legal review |
| Contract merge + e-signature | REsimpli | Yes, merge system only | P2 | Attorney templates |
| Probate, divorce, eviction lists | PropStream, PropertyRadar | Yes | P2 | Court data access |
| Tax delinquent / tax certificate lists | PropStream | Yes | P2 | Tax collector research |
| Auction calendar | PropertyRadar | Only if terms allow | P2 | Terms check |
| Condo stress flags (SIRS, assessments) | Nobody | Yes, partial | P2 | SIRS database access; assessments have no public feed |
| On-market deal finder + Day Zero alerts | Privy | Yes | P2 | MLS license |
| Buyers database auto-built from cash sales | InvestorLift, Privy | Yes | P2 | Sales data |
| Buyer matching + public deal page + view tracking | InvestorLift | Yes | P2 | — |
| CMA builder PDF EN/ES | MLS tools | Yes | P2 | MLS license |
| Zip market dashboard + "where to hunt" | Mashvisor, Privy | Yes | P2 | Sales history |
| Short-term rental estimate | Mashvisor, AirDNA | Adapter slot only | P3 | Paid source |
| Seller website / landing page EN/ES | Carrot | Yes, simple | P3 | — |
| AI assistant with citations + morning brief | REsimpli (basic) | Yes | P3 | Claude API key |
| Photo → condition suggestion | Few | Yes, labeled as suggestion | P3 | Claude API key |
| KPI dashboard (cost per lead/contract by list) | REsimpli | Yes | P3 | — |
| Playbook library | — | Yes | P3 | Source links |
| Statewide 67 counties, multi-tenant, billing | PropStream | Yes | P3 | Data licensing review |

---

## 7. Florida rules summary (not legal advice — confirm with your broker and attorney)

**Wholesaling**
- Confirmed by several 2026 guides: Florida still has no wholesaling statute and no bill in the 2026 session regulated it directly.
- The real risk is the broker licensing law (Chapter 475): marketing someone else's *property* for a fee without a license is described as a third-degree felony. Market your *contract rights*, and say in writing that you intend to assign.
- Sources disagree on what written disclosure, if any, is required. Not settled by anything I could open.

**You as a licensed agent buying for yourself**
- Background plus one dated source: licensees are expected to disclose license status when acting as a principal, and all advertising must make clear a licensee is involved (FREC advertising rule 61J2-10.025, confirmed in summary).
- A licensed agent wholesaling raises extra questions (duties to the seller, brokerage involvement, commission vs assignment fee). **Broker review before the first deal.** The app will carry an "investor hat / agent hat" switch and add the license disclosure to investor-hat documents by default.

**Calls and texts**
- Florida: 8am–8pm recipient time; max 3 calls per 24 hours per person per subject; texts and voicemail drops count as calls; automated calls/texts need prior express written consent; Florida and national Do Not Call lists apply.
- Whether a "we want to *buy* your house" call counts as a covered sales call under Florida law is argued both ways. We build as if it is covered.
- A number from skip tracing is never consent.
- Damages are quoted differently by different sources ($500 per violation up to much more). Not verified.

**Doc stamps on deeds** (confirmed in summary)
- Miami-Dade: $0.60 per $100, plus $0.45 per $100 surtax, with the surtax not applying to a single-family residence (condo unit or detached house).
- Rest of Florida, including Broward and Palm Beach: $0.70 per $100.

**Scraping**
- Zillow, Redfin and Realtor.com forbid automated access. Not used.
- Auction sites: terms unknown, so not automated until confirmed.

---

## 8. Questions for you (5 now, the rest after you answer)

1. **Repo:** which of the three options in section 1? If the real app exists, where is it?
2. **Feature list:** approve section 6 as is, or tell me what to cut, add or move.
3. **MLS:** which board and MLS are you with, do you already have a Bridge/Trestle IDX feed, and will your broker approve back-office use?
4. **Data budget to start:** $0 (yearly DOR data + free layers), about $100/month (PropStream Essentials imports *or* RentCast Foundation), or about $250+/month (add clerk feeds and skip tracing)?
5. **Your default numbers:** assignment fee target, MAO %, repair $/sq ft tiers, hard-money terms, closing cost %, commission split.

Held for the next round: attorney/title company and templates, partner permissions, brand assets, which cities matter most for code violations, dialer/SMS provider.

---

## 9. Sources

Data
- [FL DOR 2026 NAL/SDF/NAP user guide](https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal/User%20Guides/2026%20Users%20guide%20and%20quick%20reference/2026_NAL_SDF_NAP_Users_Guide.pdf) · [DOR download page](https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx)
- [Miami-Dade PA bulk data](https://bbs.miamidadepa.gov/) · [Miami-Dade Clerk developers](https://www2.miamidadeclerk.gov/Developers) · [Clerk commercial data services](https://www.miamidade.gov/clerk/commercial-data-services.page)
- [Miami-Dade open data hub](https://gis-mdc.opendata.arcgis.com) · [Code compliance violation dataset notes](https://d48reu.github.io/DataDictionary/dataset/code-compliance-violation) · [Building violation dataset notes](https://d48reu.github.io/DataDictionary/dataset/building-violation)
- [Broward PA data products](https://web.bcpa.net/InfoBroward/ProductMenu.asp) · [Broward Official Records bulk files](https://www.broward.org/RecordsTaxesTreasury/Records/Pages/IndexFiles-Completed.aspx) · [Broward Clerk API](https://www.browardclerk.org/web2/services/aboutapi) · [Broward GIS resources](https://geohub-bcgis.opendata.arcgis.com/pages/resources-for-gis-data)
- [Palm Beach Clerk electronic index service](https://www.mypalmbeachclerk.com/records/official-records/electronic-distribution-index-service) · [Palm Beach PZB lien/permit/violation searches](https://discover.pbc.gov/pzb/administration/pages/lien-permit-searches.aspx) · [Palm Beach PAO public services](https://pbcpao.gov/departments/public_services.htm)
- [Statewide parcel service](https://gis.fdacs.gov/mapping/rest/services/GIO_Parcels_for_OAWP_Optimized/FeatureServer/0)
- [DBPR SIRS reporting](https://www2.myfloridalicense.com/condominiums/condominiums-and-cooperatives-sirs-reporting/) · [OPPAGA report 26-04](https://oppaga.fl.gov/Products/ReportDetail?rn=26-04)
- [Miami Realtors IDX / Web API](https://www.miamirealtors.com/mls/webapi/) · [Miami IDX FAQ](https://www.miamirealtors.com/wp-content/uploads/bsk-pdf-manager/2024/03/IDX-FAQS.pdf)

Platforms and pricing
- [PropStream cost](https://www.propstream.com/news/how-much-does-propstream-cost) · [PropStream tiers announcement](https://www.businesswire.com/news/home/20250602015911/en/PropStream-Unveils-New-Pricing-Tiers-and-Free-Skip-Tracing%E2%80%94All-at-No-Additional-Cost)
- [PropertyRadar vs BatchLeads](https://www.propertyradar.com/compare/propertyradar-vs-batchleads) · [BatchLeads pricing review](https://resimpli.com/blog/batchleads-pricing/) · [DealMachine vs BatchLeads](https://dealmachine.com/blog/dealmachine-vs-batchleads)
- [RentCast review](https://retipster.com/rentcast-review) · [DealCheck profile](https://www.getapp.com/real-estate-property-software/a/dealcheck) · [Carrot pricing](https://carrot.com/go/pricing-packages/)
- [Tracerfy skip tracing API](https://www.tracerfy.com/skip-tracing-api) · [BatchData cost benchmarks](https://batchdata.io/blog/skip-tracing-cost-benchmarks)

Playbooks
- [REsimpli list stacking guide](https://resimpli.com/blog/wholesalers-guide-to-list-stacking/) · [DealMachine triple-signal map](https://www.dealmachine.com/blog/motivated-seller-leads-wholesaling-triple-signal-map)
- [Brent Daniels four pillars](https://disruptors.com/episodes/how-brent-daniels-generated-1-million-in-fees-with-one-simple-concept) · [Wholesaling Inc TTP framework](https://wholesalinginc.libsyn.com/wip-505-revealed-discover-the-6-step-framework-to-brent-daniels-ttp-method)
- [Pace Morby on BiggerPockets](https://www.biggerpockets.com/show527) · [Carrot: creative finance with Pace Morby](https://carrot.com/blog/creative-finance-strategies-pace-morby/)

Law
- [Real Estate Skills: Florida wholesaling](https://www.realestateskills.com/blog/wholesaling-real-estate-legal-florida) · [REsimpli wholesaling laws by state](https://resimpli.com/blog/wholesaling-laws-and-regulations/)
- [FREC advertising rule 61J2-10.025](https://www.law.cornell.edu/regulations/florida/Fla-Admin-Code-Ann-R-61J2-10-025)
- [FL Senate 2021 SB 1120 enrolled text (calling hours, 3-call cap)](https://flsenate.gov/Session/Bill/2021/1120/BillText/er/PDF) · [Fla. Stat. 501.616](https://www.flsenate.gov/Laws/Statutes/2023/501.616) · [Fla. Stat. 501.059](https://www.flsenate.gov/Laws/Statutes/2023/501.059)
- [FTSA guide](https://numberbroom.com/state-tcpa-laws/florida) · [Texting quiet hours by state](https://www.fransis.ai/articles/texting-quiet-hours-tcpa-state-rules)
- [FCC revoke-all delay to 01/31/2027](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027)
- [FL DOR documentary stamp tax](https://floridarevenue.com/taxes/taxesfees/pages/doc_stamp.aspx) · [Surtax rule 12B-4.012](https://state-rules.com/florida/fac/12B-4.012/)
