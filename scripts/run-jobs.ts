// Background jobs runner. Run on a schedule (cron, systemd timer, or a queue
// worker in prod): `npx tsx scripts/run-jobs.ts`
// Jobs are idempotent per day — safe to re-run.
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { runDueRecurringInvoices } from '../src/lib/invoicing/recurring';

async function main() {
  console.log(`[jobs] ${new Date().toISOString()} starting`);

  const recurring = await runDueRecurringInvoices();
  for (const r of recurring) {
    if (r.error) console.error(`[jobs] recurring ${r.recurringInvoiceId} FAILED: ${r.error}`);
    else console.log(`[jobs] recurring ${r.recurringInvoiceId} -> invoice #${r.invoiceNumber}`);
  }
  if (recurring.length === 0) console.log('[jobs] no recurring invoices due');

  console.log('[jobs] done');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
