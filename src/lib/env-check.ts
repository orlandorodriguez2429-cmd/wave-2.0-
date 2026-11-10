// Refuse to run in production without the secrets the app depends on.
// Called from src/instrumentation.ts at server start (and by the Docker
// entrypoint before migrations). Returns a list of problems; empty = OK.
export function productionEnvProblems(env: Record<string, string | undefined> = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const key = env.ENCRYPTION_KEY ?? '';
  let keyBytes = 0;
  try {
    keyBytes = Buffer.from(key, 'base64').length;
  } catch {
    keyBytes = 0;
  }
  if (!key) problems.push('ENCRYPTION_KEY is not set.');
  else if (keyBytes !== 32) problems.push('ENCRYPTION_KEY must be 32 random bytes, base64-encoded.');
  else if (key === '3Jze7fSYxvxXRtj1PWp3e3Mv7Xv7KvXGGzXieeNIFEk=' && env.LOCAL_DEMO !== 'true') {
    problems.push('ENCRYPTION_KEY is the public development key from docker-compose.yml. Generate your own.');
  }

  // LOCAL_DEMO=true (docker compose on your own computer) may run without
  // Plaid / cron; it must never be set on a real server.
  if (env.LOCAL_DEMO === 'true') return problems;

  if (!env.PLAID_CLIENT_ID) problems.push('PLAID_CLIENT_ID is not set.');
  if (!env.PLAID_SECRET) problems.push('PLAID_SECRET is not set.');
  if (env.PLAID_ENV !== 'sandbox' && env.PLAID_ENV !== 'production') problems.push('PLAID_ENV must be "sandbox" or "production".');
  if (!env.PLAID_WEBHOOK_URL?.startsWith('https://')) problems.push('PLAID_WEBHOOK_URL must be the public https:// URL of /api/plaid/webhook.');
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) problems.push('CRON_SECRET must be set (at least 32 characters).');
  if (!env.APP_URL?.startsWith('https://')) problems.push('APP_URL must be your https:// address (used in invitation links).');
  return problems;
}
