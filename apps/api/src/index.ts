// Boot entry — server.ts is side-effectful (calls app.listen).
//
// When SECRETS_BACKEND=azure_keyvault we MUST resolve secrets
// asynchronously BEFORE server.ts is imported, because server.ts
// imports config.ts at module-load time and config.ts reads
// process.env synchronously (validates JWT secrets etc.).
//
// For env / json / file backends, server.ts's own top-level
// loadSecrets() call still runs (synchronously) during the dynamic
// import below, so the non-Azure boot path is unchanged.
//
// BUG-366a L5 absorb — package.json "start", Dockerfile CMD, and all
// three ecosystem.config.js entries now route through this file. If
// server.ts is invoked directly (bypassing index.ts) with
// SECRETS_BACKEND=azure_keyvault, server.ts's sync loadSecrets()
// would throw with a diagnostic pointing back at loadSecretsAsync.
import { loadSecretsAsync, getSecretsBackendName } from './config/secrets';

async function boot(): Promise<void> {
  if (getSecretsBackendName() === 'azure_keyvault') {
    await loadSecretsAsync();
    // loadSecretsAsync already emits a structured `secrets.resolved`
    // event — no duplicate log here.
  }
  // BUG-378 (2026-05-03) — PHI encryption boot-time round-trip self-test.
  // Runs AFTER secrets are loaded (Key Vault path) so the key is in
  // process.env, BEFORE server.ts is imported (so a broken key makes
  // boot fail loud instead of surfacing on the first clinical write
  // hours later). Sibling pattern of CLAUDE.md §17.4 retention triple-
  // lock: catch misconfiguration at the earliest possible point.
  const { runPhiEncryptionSelfTest } = await import('./shared/phiEncryption');
  runPhiEncryptionSelfTest();
  await import('./server');
}

boot().catch((err: unknown) => {
  // Structured fatal for deploy diagnostics. App Insights / Sentry
  // are NOT yet initialised at this point in boot, so stderr is the
  // only channel. Includes backend + vault URL + err.code so operator
  // can distinguish wrong-URL / missing-managed-identity / RBAC-missing
  // / network from a single log line.
  const e = err as { message?: string; code?: string; stack?: string };
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({
    event: 'boot.failed',
    backend: getSecretsBackendName(),
    vaultUrl: process.env.AZURE_KEYVAULT_URL,
    err: { message: e?.message, code: e?.code, stack: e?.stack },
  }));
  process.exit(1);
});
