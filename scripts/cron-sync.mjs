// Daily backstop bank sync. Run by the host's scheduler:
//   APP_URL=https://books.example.com CRON_SECRET=... node scripts/cron-sync.mjs
// No dependencies (Node 20+ fetch). Exits non-zero on failure so the
// scheduler reports it.
const url = `${(process.env.APP_URL ?? '').replace(/\/+$/, '')}/api/cron/sync`;
const secret = process.env.CRON_SECRET;
if (!process.env.APP_URL || !secret) {
  console.error('APP_URL and CRON_SECRET must be set.');
  process.exit(1);
}
const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
const body = await res.text();
console.log(`[cron-sync] ${res.status} ${body}`);
process.exit(res.ok ? 0 : 1);
