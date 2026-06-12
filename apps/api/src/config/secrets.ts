/**
 * apps/api/src/config/secrets.ts
 *
 * S4.1 — Secrets resolver
 *
 * The pre-S4.1 codebase read every secret directly from process.env.
 * This module is a thin pre-process step: it identifies sensitive
 * env var names, attempts to load each one from the configured
 * secret backend, and writes the resolved value back into
 * process.env BEFORE the rest of the codebase reads it.
 *
 * That keeps every existing reader (config.ts, blobStorage.ts,
 * smartAuth.ts, etc.) working unchanged — they still read
 * process.env.X and the resolver has already populated X.
 *
 * Backend selection by env var:
 *
 *   SECRETS_BACKEND=env             (default — process.env, no-op)
 *   SECRETS_BACKEND=json            (load from a single JSON env var
 *                                    SECRETS_JSON, useful for k8s
 *                                    Secrets mounted as a Volume +
 *                                    consumed via valueFrom.secretRef
 *                                    where the value IS the JSON)
 *   SECRETS_BACKEND=file            (load from a JSON file at
 *                                    SECRETS_FILE_PATH; intended for
 *                                    SOPS-decrypted secrets.yaml
 *                                    rendered to JSON at deploy time)
 *   SECRETS_BACKEND=azure_keyvault  (BUG-366a — load each sensitive
 *                                    key from Azure Key Vault named
 *                                    at AZURE_KEYVAULT_URL using
 *                                    managed-identity auth via
 *                                    DefaultAzureCredential. App
 *                                    Service also supports
 *                                    '@Microsoft.KeyVault(SecretUri=…)'
 *                                    references in application
 *                                    settings which land as plain
 *                                    env vars and need no backend —
 *                                    use this backend only when
 *                                    the resolver needs to look up
 *                                    secrets beyond the App Service
 *                                    managed set.)
 *
 * Future backends (Vault, AWS Secrets Manager) plug in as new cases
 * in resolveSecretsBackend() — every existing reader stays unchanged.
 *
 * Sensitive var allow-list: only the names below are eligible for
 * resolution. This is intentional — the resolver is NEVER given a
 * blanket "look up everything in env" mandate, because that would
 * let an attacker who can write to process.env smuggle in arbitrary
 * config (PORT, NODE_ENV, etc.) by injecting it into the secret
 * backend.
 *
 * Naming compliance: env var keys uppercase + underscore (the env
 * var convention), function exports camelCase.
 */

import fs from 'fs';

const SENSITIVE_KEYS: ReadonlyArray<string> = [
  // DB
  'DB_PASSWORD',
  'DB_APP_PASSWORD',
  // JWT
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  // Redis (if it has auth)
  'REDIS_URL',
  // Sentry
  'SENTRY_DSN',
  // O365
  'O365_CLIENT_SECRET',
  // S3 / blob storage
  'BLOB_AZURE_ACCOUNT_KEY',
  'BLOB_S3_ACCESS_KEY_ID',
  'BLOB_S3_SECRET_ACCESS_KEY',
  // Webhook keys (the receiver also stores these in DB; this allow-
  // list lets ops bootstrap a webhook secret via env var if they
  // can't reach the admin UI)
  'WEBHOOK_BOOTSTRAP_SECRET',
  // SMART OAuth
  'SMART_CLIENT_SECRET',
  // OTel exporter token (if the collector requires auth)
  'OTEL_EXPORTER_OTLP_HEADERS',
  // BUG-297 — NASH mTLS certificate passphrase for HI Service SOAP
  // calls (IHI/HPII/HPIO lookup + verification). Required when
  // HI_SERVICE_CERT_PATH is set.
  'HI_SERVICE_CERT_PASSPHRASE',
  // NPDS (ADHA) mTLS certificate passphrase — was not previously
  // listed but referenced by npdsClient.ts:50. Added for parity
  // with HI Service.
  'ADHA_CERT_PASSPHRASE',
  // BUG-WF81 — NPDS payload hardening keys (detached PKI signature +
  // optional AES-256 envelope). Keep these in the sensitive resolver
  // allow-list so Azure Key Vault / file-backed secrets flows can
  // populate them before runtime reads.
  'NPDS_PAYLOAD_SIGNING_PRIVATE_KEY_PEM',
  'NPDS_PAYLOAD_ENCRYPTION_KEY_HEX',
  // BUG-366a L4 BLOCK absorb — PHI-at-rest encryption + auth-boundary
  // keys that were missing from the allowlist. With
  // SECRETS_BACKEND=azure_keyvault on a non-App-Service host (VM,
  // Container Apps, AKS) these were never queried by the resolver;
  // the `@Microsoft.KeyVault(...)` literal from .env.production.template
  // would land in process.env and either Zod-crash at config.ts or
  // (for optional keys like PHI_ENCRYPTION_KEY) silently leave PHI
  // encryption off. HIPAA § 164.312(a)(2)(iv) requires encryption
  // key management — these MUST go through the resolver.
  'PHI_ENCRYPTION_KEY',
  'PHI_ENCRYPTION_KEYRING_JSON',
  'PHI_ENCRYPTION_ACTIVE_KEY_VERSION',
  'BLIND_INDEX_KEY',
  'PATIENT_APP_DEDUPE_PEPPER',
  'SESSION_SECRET',
  'CALENDAR_ICAL_SECRET',
  'SIGNACARE_LICENSE_SECRET',
];

/**
 * BUG-366a L4 BLOCK absorb — secrets whose absence in production is a
 * clinical-safety / auth-boundary failure. When NODE_ENV=production
 * AND any of these is missing from process.env after the resolver
 * completes, boot aborts with a fatal error naming the missing key.
 *
 * Non-production (dev, test, CI) skips this gate so local .env
 * placeholders with test-only values continue to work.
 */
const REQUIRED_IN_PRODUCTION: ReadonlyArray<string> = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_APP_PASSWORD',
  'BLIND_INDEX_KEY',
  'PATIENT_APP_DEDUPE_PEPPER',
];

export type SecretsBackendName = 'env' | 'json' | 'file' | 'azure_keyvault';

export function getSecretsBackendName(): SecretsBackendName {
  const raw = (process.env.SECRETS_BACKEND ?? 'env').toLowerCase();
  if (raw === 'json' || raw === 'file' || raw === 'env' || raw === 'azure_keyvault') return raw;
  // Unknown backend -> fall back to env so the process at least starts
  // and logs a warning. We deliberately do NOT throw so a typo in
  // SECRETS_BACKEND can't cause a startup loop.
  // eslint-disable-next-line no-console
  console.warn(`[secrets] unknown SECRETS_BACKEND=${raw}, falling back to 'env'`);
  return 'env';
}

interface SecretSource {
  load(): Record<string, string>;
}

class EnvSecretSource implements SecretSource {
  load(): Record<string, string> {
    // No-op — the env vars are already in process.env. Returns an
    // empty map so the resolver doesn't overwrite anything.
    return {};
  }
}

class JsonSecretSource implements SecretSource {
  load(): Record<string, string> {
    const raw = process.env.SECRETS_JSON;
    if (!raw) {
      throw new Error('SECRETS_BACKEND=json requires SECRETS_JSON env var');
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('SECRETS_JSON must be a JSON object');
      }
      return parsed as Record<string, string>;
    } catch (err) {
      throw new Error(`SECRETS_BACKEND=json failed to parse SECRETS_JSON: ${(err as Error).message}`);
    }
  }
}

class FileSecretSource implements SecretSource {
  load(): Record<string, string> {
    const path = process.env.SECRETS_FILE_PATH;
    if (!path) {
      throw new Error('SECRETS_BACKEND=file requires SECRETS_FILE_PATH env var');
    }
    if (!fs.existsSync(path)) {
      throw new Error(`SECRETS_BACKEND=file: file not found at ${path}`);
    }
    const raw = fs.readFileSync(path, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('secrets file must contain a JSON object');
      }
      return parsed as Record<string, string>;
    } catch (err) {
      throw new Error(`SECRETS_BACKEND=file: failed to parse ${path}: ${(err as Error).message}`);
    }
  }
}

function resolveSecretsBackend(): SecretSource {
  switch (getSecretsBackendName()) {
    case 'env': return new EnvSecretSource();
    case 'json': return new JsonSecretSource();
    case 'file': return new FileSecretSource();
    case 'azure_keyvault':
      throw new Error(
        'SECRETS_BACKEND=azure_keyvault requires the async resolver. ' +
        'Call loadSecretsAsync() from server.ts instead of loadSecrets(). ' +
        'See docs/plans/azure-staging-deployment.md §2.4.',
      );
  }
}

/**
 * BUG-366a — Azure Key Vault key-name normalisation. Key Vault secret
 * names must be alphanumeric + '-'. Map UPPER_SNAKE_CASE env var
 * names to kebab-lower for lookup. Example: `JWT_ACCESS_SECRET` →
 * `jwt-access-secret` in the vault.
 */
export function envKeyToVaultSecretName(envKey: string): string {
  return envKey.toLowerCase().replace(/_/g, '-');
}

/**
 * BUG-366a — async Azure Key Vault resolver.
 *
 * Auth uses `@azure/identity` DefaultAzureCredential which transparently
 * picks up managed-identity on Azure App Service / Container Apps / VMs,
 * falls back to `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` + `AZURE_TENANT_ID`
 * for local dev, and falls back to `az login` CLI creds.
 *
 * Requires `AZURE_KEYVAULT_URL` env var (e.g.
 * `https://signacare-staging-kv.vault.azure.net`).
 *
 * Each sensitive key from `SENSITIVE_KEYS` is looked up in parallel.
 * Missing secrets are SILENTLY skipped (matches the json / file
 * backend contract) — ops populates only the keys they want in Key
 * Vault and the rest fall through to plain env (e.g.
 * `@Microsoft.KeyVault(SecretUri=…)` App Service references that
 * Azure already materialises into plain env vars).
 *
 * Called from server.ts BEFORE any other module that reads
 * `process.env` (specifically BEFORE `config.ts` which validates
 * env vars at module-load time).
 */
export async function loadSecretsAsync(): Promise<{ backend: SecretsBackendName; loadedCount: number }> {
  const backend = getSecretsBackendName();
  // Non-Azure backends delegate to the sync path unchanged.
  if (backend !== 'azure_keyvault') {
    return loadSecrets();
  }

  const vaultUrl = process.env.AZURE_KEYVAULT_URL;
  if (!vaultUrl) {
    throw new Error('SECRETS_BACKEND=azure_keyvault requires AZURE_KEYVAULT_URL env var');
  }

  // Dynamic import keeps the @azure/* deps out of the cold path when
  // the backend isn't used. (They're installed in apps/api but Node
  // can skip linking them at startup.)
  const { SecretClient } = await import('@azure/keyvault-secrets');
  const { DefaultAzureCredential } = await import('@azure/identity');

  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUrl, credential);

  // Parallel lookup of every sensitive key. Missing keys return
  // undefined — NOT treated as an error so the backend matches the
  // existing contract of json / file.
  const results = await Promise.all(
    SENSITIVE_KEYS.map(async (envKey) => {
      const secretName = envKeyToVaultSecretName(envKey);
      try {
        const s = await client.getSecret(secretName);
        return { envKey, value: s.value };
      } catch (err: unknown) {
        // SecretNotFound is the happy case for "ops didn't populate
        // this key"; any other error (auth / network) is fatal.
        const code = (err as { code?: string })?.code;
        if (code === 'SecretNotFound') return { envKey, value: undefined };
        throw new Error(
          `SECRETS_BACKEND=azure_keyvault: failed to load '${secretName}' from ${vaultUrl}: ${(err as Error).message}`,
        );
      }
    }),
  );

  const resolved: string[] = [];
  const skipped: string[] = [];
  for (const { envKey, value } of results) {
    if (typeof value === 'string' && value.length > 0) {
      process.env[envKey] = value;
      resolved.push(envKey);
    } else {
      skipped.push(envKey);
    }
  }
  // Structured audit-trail of what the resolver touched. Never logs
  // values — only key names. Safe for Application Insights / Sentry
  // log pipelines. Using console here because pino logger is not
  // yet initialised at this point in boot.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    event: 'secrets.resolved',
    backend,
    vaultUrl,
    resolved,
    skipped,
  }));
  assertRequiredInProduction(backend);
  return { backend, loadedCount: resolved.length };
}

/**
 * BUG-366a L4 BLOCK absorb — enforce REQUIRED_IN_PRODUCTION at
 * resolver exit. In production, every name in this list MUST be
 * present in process.env by the time the resolver returns. If any
 * is missing, boot throws — no silent partial-population.
 *
 * Non-production (dev, test, CI) is a no-op.
 */
function assertRequiredInProduction(backend: SecretsBackendName): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing = REQUIRED_IN_PRODUCTION.filter(
    (k) => typeof process.env[k] !== 'string' || process.env[k]!.length === 0,
  );
  const hasLegacyPhiKey = typeof process.env.PHI_ENCRYPTION_KEY === 'string'
    && process.env.PHI_ENCRYPTION_KEY.trim().length > 0;
  const hasPhiKeyring = typeof process.env.PHI_ENCRYPTION_KEYRING_JSON === 'string'
    && process.env.PHI_ENCRYPTION_KEYRING_JSON.trim().length > 0;
  if (!hasLegacyPhiKey && !hasPhiKeyring) {
    missing.push('PHI_ENCRYPTION_KEY or PHI_ENCRYPTION_KEYRING_JSON');
  }
  if (missing.length > 0) {
    throw new Error(
      `[secrets] NODE_ENV=production but REQUIRED_IN_PRODUCTION keys missing ` +
      `after SECRETS_BACKEND=${backend} resolution: ${missing.join(', ')}. ` +
      `Populate these in your secrets backend or set them in process.env.`,
    );
  }
}

/**
 * Public entry point. Called from index.ts BEFORE config.ts is
 * imported (the latter validates env vars at module load).
 *
 * Each sensitive key is looked up in the configured backend. If the
 * backend returns a non-empty string for that key, process.env[key]
 * is overwritten. If the backend has no value for a key, process.env
 * is left alone — so a partial secrets file can override only the
 * keys it cares about and let the rest fall through to env.
 *
 * Returns the count of keys actually loaded for diagnostics.
 */
export function loadSecrets(): { backend: SecretsBackendName; loadedCount: number } {
  const backend = getSecretsBackendName();
  if (backend === 'env') {
    // Production env-backend still enforces REQUIRED_IN_PRODUCTION —
    // ops must have populated the env vars directly before boot.
    assertRequiredInProduction(backend);
    return { backend, loadedCount: 0 };
  }
  const source = resolveSecretsBackend();
  const loaded = source.load();
  const resolved: string[] = [];
  const skipped: string[] = [];
  for (const key of SENSITIVE_KEYS) {
    const value = loaded[key];
    if (typeof value === 'string' && value.length > 0) {
      process.env[key] = value;
      resolved.push(key);
    } else {
      skipped.push(key);
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    event: 'secrets.resolved',
    backend,
    resolved,
    skipped,
  }));
  assertRequiredInProduction(backend);
  return { backend, loadedCount: resolved.length };
}

/** Test helper — exported for unit tests. */
export const _SENSITIVE_KEYS: ReadonlyArray<string> = SENSITIVE_KEYS;
