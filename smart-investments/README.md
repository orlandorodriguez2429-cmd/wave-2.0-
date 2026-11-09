# Smart Investments Today

South Florida property analysis and lead finding, with a source and date on every number.

This folder is a self-contained app. It shares nothing with the Wave 2.0 accounting app in the
repository root and can be moved to its own repository as-is. Research and the approved-feature
list are in [`../docs/research.md`](../docs/research.md).

## What works today (Miami-Dade, free data only)

| Screen | What it does |
|---|---|
| Analyzer (`/`) | Type an address or 13-digit folio. Handles "West 32nd Way" style input, unit numbers, and offers a pick list when several parcels match. |
| Deal Report (`/property/[folio]`) | Owner and mailing address, absentee / out-of-state / company flags, building facts, last deed transfer, county violations, motivation score with reasons, value estimate from recent recorded sales with a comp list you can untick, six exit strategies that recalculate as you type, Florida checks, and an English + Spanish call script and letter. "Export PDF" prints a clean copy. |
| Lead Finder (`/leads`) | Scores every parcel in a zip code and lists the highest, each with its reasons. |
| Pipeline (`/pipeline`) | Leads saved from a report, grouped by stage, with investor/agent hat and notes. **Test storage only**: a JSON file in `.data/`, no login, not for Vercel. |
| Market (`/market`) | For a zip code: market sales in the last 12 months, median price and $/sq ft by property type, 6-month trend, share of purchases by investors, absentee and long-term owner shares. |
| Buyers (`/buyers`) | Companies and repeat buyers who bought in a zip in the last 12 months, with what and where they bought. Cash vs financed is not known; no contact details. |
| Data (`/data`) | Which adapters are on, what each covers, calls made, and the score weights. |

English/Spanish and light/dark toggles are in the top bar.

## Data sources in use

| Source | Gives | Refresh | Limits |
|---|---|---|---|
| Miami-Dade Property Appraiser "Property Point View" (county open data) | Owner, mailing address, beds/baths/size, year, assessed value, last deed transfer | Weekly | No homestead flag, no mortgages, only the latest transfer |
| Miami-Dade Code Compliance + Building Violations (county open data) | Open/closed cases, liens, unsafe structures, expired permits, foreclosed-property registry | Daily | **Unincorporated county only.** City parcels (Hialeah, Miami, …) show "Unknown" |
| FEMA National Flood Hazard Layer | Flood zone at the parcel's center point | FEMA-maintained | Service sometimes drops connections; then the zone shows "Unknown". Not a lender flood determination |
| U.S. Census geocoder | Fallback address match | — | — |

Shown as "Unknown" until a source is connected: zoning, rent, insurance, taxes actually
billed, homestead, mortgages and equity, lis pendens, tax delinquency, probate, vacancy, listings.

## Rules the code follows

- A missing value is `null` and renders as "Unknown". Nothing is filled with a guess.
- The value estimate is labeled an as-is estimate with a confidence level. It is not ARV; the user sets ARV.
- Assumptions (closing costs, loan terms, tax rate…) are editable placeholders and labeled as such.
  Only the 70% MAO and $25/$45/$70 repair tiers come from the owner's brief.
- Outreach limits are in `src/lib/compliance/calling.ts`: 8 am–8 pm recipient time, 3 attempts per
  24 hours per person, Do Not Call and opt-out blocks, written consent for anything automated.
  They are tested but not yet attached to a dialer or CRM.
- No scraping of sites whose terms forbid it.

## Run it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run check:addresses -- "10236 W 32 Way, Hialeah" "30-6019-011-4460"
```

No keys are needed for the free tier. Inside a Claude Code cloud session, where outbound traffic
goes through a proxy, use `npm run cloud` instead (builds and serves on port 3100). Deploy to Vercel with this folder as the project root.

## Not built yet

- Supabase: `supabase/migrations/0001_init.sql` is written but has **not been applied or tested**;
  there is no login, the pipeline is a local test file, and the cache and call counts live in memory.
- Scheduled ingest. Lookups hit the county services live (2–10 s per property, 20–30 s per zip).
  Loading the weekly file into the database is what makes this fast and enables change alerts.
- Broward and Palm Beach, map view, saved searches and alerts, the real CRM (tasks, outreach log, partner assignment), skip tracing,
  buyer buy-boxes and deal pages, agent tools, rent and days-on-market stats, AI assistant, photo or listing-link input.
- Paid adapters (RentCast, Clerk records, skip tracing, MLS) are listed on the Data page but have no code.

## Layout

```
src/lib/adapters/     adapter interfaces, ArcGIS client, Miami-Dade adapters, registry
src/lib/analysis/     owner flags, comps/value, strategies, Florida costs, score, approach scripts
src/lib/compliance/   calling-window and consent rules
src/lib/report.ts     address lookup, Deal Report and Lead Finder assembly
src/app/              screens
supabase/migrations/  database schema (unapplied)
```
