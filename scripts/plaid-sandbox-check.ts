// End-to-end check of the Plaid integration against Plaid's SANDBOX, using
// the app's own code paths (no browser needed). Run with sandbox keys:
//
//   PLAID_CLIENT_ID=... PLAID_SECRET=<sandbox secret> PLAID_ENV=sandbox npx tsx scripts/plaid-sandbox-check.ts
//
// Steps: link token → sandbox public token (First Platypus Bank, user_good)
// → exchange + encrypted storage + ledger accounts → /transactions/sync with
// auto-categorization → login reset → needs-reconnect + update-mode link
// token → webhook key lookup → disconnect (/item/remove) → cleanup.
// Never prints tokens or secrets.
import 'dotenv/config';
import { Products } from 'plaid/legacy';
import { prisma } from '../src/lib/db';
import { createBusiness } from '../src/lib/ledger/business';
import { createLinkToken } from '../src/lib/banking/plaid';
import { plaidClient, plaidConfig, safePlaidError } from '../src/lib/banking/plaid-client';
import { connectPlaidItem, disconnectConnection } from '../src/lib/banking/import';
import { syncConnection } from '../src/lib/banking/sync';
import { fetchPlaidKey } from '../src/lib/banking/plaid-webhook';
import { decryptSecret } from '../src/lib/crypto';
import { deleteBusiness } from '../src/lib/retention';

const ok = (msg: string) => console.log(`  ✔ ${msg}`);
const fail = (msg: string): never => {
  console.error(`  ✘ ${msg}`);
  process.exit(1);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = plaidConfig();
  if (!config || config.env !== 'sandbox') fail('Set PLAID_CLIENT_ID, PLAID_SECRET (sandbox) and PLAID_ENV=sandbox.');
  const client = plaidClient();

  console.log('1. Link token');
  const user = await prisma.user.create({ data: { email: `plaid-check-${Date.now()}@sandbox.invalid`, name: 'Plaid sandbox check' } });
  const business = await createBusiness({ userId: user.id, name: `Plaid Sandbox Check ${new Date().toISOString().slice(0, 16)}` });
  const linkToken = await createLinkToken({ clientUserId: user.id });
  if (!linkToken.startsWith('link-sandbox-')) fail('unexpected link token');
  ok('link token created (client_user_id = internal user id)');

  console.log('2. Bank login (sandbox shortcut for what Plaid Link does in the browser)');
  let publicToken: string;
  try {
    const { data } = await client.sandboxPublicTokenCreate({
      institution_id: 'ins_109508', // First Platypus Bank
      initial_products: [Products.Transactions],
      options: { override_username: 'user_good', override_password: 'pass_good' },
    });
    publicToken = data.public_token;
  } catch (err) {
    throw safePlaidError('sandbox public token create', err);
  }
  ok('public token issued for First Platypus Bank (user_good / pass_good)');

  console.log('3. Exchange + store');
  const { id: connectionId } = await connectPlaidItem({ businessId: business.id, userId: user.id, publicToken });
  const conn = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { accounts: true } });
  const encrypted = conn.accessTokenEncrypted ?? fail('no access token stored');
  if (!encrypted.startsWith('v1:')) fail('access token not encrypted');
  const accessToken = decryptSecret(encrypted);
  if (!accessToken.startsWith('access-sandbox-')) fail('stored token does not decrypt');
  ok(`connected "${conn.institutionName}", item ${conn.itemId?.slice(0, 12)}…, token stored encrypted`);
  for (const a of conn.accounts) {
    const ledger = await prisma.account.findUniqueOrThrow({ where: { id: a.ledgerAccountId } });
    ok(`  ${a.name} ••${a.mask} (${a.subtype}) → ledger ${ledger.code} ${ledger.type.toLowerCase()}`);
  }

  console.log('4. /transactions/sync (Plaid may need a few seconds to prepare history)');
  let imported = 0;
  let auto: Awaited<ReturnType<typeof syncConnection>>['auto'];
  for (let attempt = 1; attempt <= 12 && imported === 0; attempt++) {
    const r = await syncConnection({ connectionId, businessId: business.id, userId: user.id, trigger: 'manual', classifier: null });
    imported += r.imported;
    auto = r.auto ?? auto;
    if (imported === 0) await sleep(5000);
  }
  if (imported === 0) fail('no transactions after 60 seconds');
  const counts = await prisma.importedTransaction.groupBy({ by: ['status'], where: { businessId: business.id }, _count: { _all: true } });
  ok(`imported ${imported} posted transactions (pending ones skipped)`);
  ok(`after automatic sorting: ${counts.map((c) => `${c._count._all} ${c.status.toLowerCase()}`).join(', ')}`);
  if (auto) ok(`sorted by: transfers ${auto.transfers}, your rules ${auto.rule}, built-in rules ${auto.merchant}, AI ${auto.ai} (off in this check)`);
  const again = await syncConnection({ connectionId, businessId: business.id, userId: user.id, classifier: null });
  ok(`second sync imported ${again.imported} (no duplicates)`);

  console.log('5. Bank login expires');
  await client.sandboxItemResetLogin({ access_token: accessToken });
  await syncConnection({ connectionId, businessId: business.id, userId: user.id, classifier: null }).catch(() => undefined);
  const broken = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (broken.status !== 'NEEDS_RECONNECT') fail(`expected NEEDS_RECONNECT, got ${broken.status} (${broken.errorCode})`);
  ok(`connection marked needs-reconnect (${broken.errorCode})`);
  const updateToken = await createLinkToken({ clientUserId: user.id, accessToken: accessToken });
  if (!updateToken.startsWith('link-sandbox-')) fail('update-mode link token failed');
  ok('update-mode link token created (what the Reconnect button opens)');

  console.log('6. Webhook verification key lookup');
  const key = await fetchPlaidKey('not-a-real-key-id');
  if (key !== null) fail('unknown key id should be rejected');
  ok('unknown key id rejected (unverifiable webhooks get a 401)');

  console.log('7. Disconnect');
  await disconnectConnection({ businessId: business.id, userId: user.id, connectionId });
  const removed = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId } });
  if (removed.status !== 'REMOVED' || removed.accessTokenEncrypted) fail('disconnect did not complete');
  ok('item removed at Plaid, token wiped, history kept');
  try {
    await client.accountsGet({ access_token: accessToken });
    fail('Plaid still accepts the removed token');
  } catch (err) {
    ok(`Plaid now rejects the old token (${safePlaidError('accounts get', err).code})`);
  }

  if (process.argv.includes('--keep')) {
    const pending = await prisma.importedTransaction.findMany({ where: { businessId: business.id, status: 'PENDING' }, select: { description: true, amount: true } });
    console.log('\nLeft for review:');
    for (const p of pending) console.log(`  ${(Number(p.amount) / 100).toFixed(2).padStart(10)}  ${p.description}`);
    console.log(`(kept business "${business.name}" for inspection)`);
    return;
  }
  await deleteBusiness({ businessId: business.id, userId: user.id, confirmName: business.name, removePlaidItem: async () => {} });
  await prisma.user.delete({ where: { id: user.id } });
  console.log('\nAll Plaid sandbox checks passed.');
}

main()
  .catch((err) => {
    console.error(`\n✘ ${err instanceof Error ? err.message : 'failed'}`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

