// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { productionEnvProblems } = await import('./lib/env-check');
  const problems = productionEnvProblems();
  if (problems.length > 0) {
    console.error(`\n[startup] Refusing to start in production:\n  - ${problems.join('\n  - ')}\n`);
    process.exit(1);
  }
}
