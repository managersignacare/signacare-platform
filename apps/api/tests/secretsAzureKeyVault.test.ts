/**
 * BUG-366a — Azure Key Vault secrets backend unit tests
 *
 * loadSecretsAsync() uses dynamic imports of @azure/keyvault-secrets
 * and @azure/identity so the SDK is not loaded on the env/json/file
 * hot paths. These tests mock both modules via vi.mock() so no real
 * Azure calls are made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  loadSecretsAsync,
  envKeyToVaultSecretName,
  _SENSITIVE_KEYS,
} from '../src/config/secrets';

const getSecretMock = vi.fn<(name: string) => Promise<{ value?: string }>>();
const SecretClientCtor = vi.fn();
const DefaultAzureCredentialCtor = vi.fn();

vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class {
    constructor(url: string, credential: unknown) {
      SecretClientCtor(url, credential);
    }
    getSecret = getSecretMock;
  },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {
    constructor() {
      DefaultAzureCredentialCtor();
    }
  },
}));

const ORIGINAL_ENV: Record<string, string | undefined> = {};
function snapshotEnv(): void {
  for (const key of _SENSITIVE_KEYS) ORIGINAL_ENV[key] = process.env[key];
  ORIGINAL_ENV['SECRETS_BACKEND'] = process.env.SECRETS_BACKEND;
  ORIGINAL_ENV['AZURE_KEYVAULT_URL'] = process.env.AZURE_KEYVAULT_URL;
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  snapshotEnv();
  getSecretMock.mockReset();
  SecretClientCtor.mockReset();
  DefaultAzureCredentialCtor.mockReset();
});
afterEach(() => restoreEnv());

describe('envKeyToVaultSecretName', () => {
  it('maps UPPER_SNAKE env names to kebab-lower vault secret names', () => {
    expect(envKeyToVaultSecretName('JWT_ACCESS_SECRET')).toBe('jwt-access-secret');
    expect(envKeyToVaultSecretName('DB_APP_PASSWORD')).toBe('db-app-password');
    expect(envKeyToVaultSecretName('BLOB_AZURE_ACCOUNT_KEY')).toBe('blob-azure-account-key');
    expect(envKeyToVaultSecretName('BLOB_S3_SECRET_ACCESS_KEY')).toBe('blob-s3-secret-access-key');
    expect(envKeyToVaultSecretName('HI_SERVICE_CERT_PASSPHRASE')).toBe('hi-service-cert-passphrase');
  });
});

describe('loadSecretsAsync — azure_keyvault backend', () => {
  it('throws when AZURE_KEYVAULT_URL is missing', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    delete process.env.AZURE_KEYVAULT_URL;
    await expect(loadSecretsAsync()).rejects.toThrow(/AZURE_KEYVAULT_URL/);
  });

  it('constructs SecretClient with the vault URL and DefaultAzureCredential', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    // All secrets miss — this test only verifies client wiring.
    getSecretMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'SecretNotFound' }));
    await loadSecretsAsync();
    expect(DefaultAzureCredentialCtor).toHaveBeenCalledTimes(1);
    expect(SecretClientCtor).toHaveBeenCalledTimes(1);
    expect(SecretClientCtor.mock.calls[0]?.[0]).toBe('https://test-kv.vault.azure.net');
  });

  it('looks up every SENSITIVE_KEY using kebab-lower name mapping', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    getSecretMock.mockRejectedValue(Object.assign(new Error('nf'), { code: 'SecretNotFound' }));
    await loadSecretsAsync();
    const calledNames = getSecretMock.mock.calls.map((c) => c[0]);
    expect(calledNames).toContain('jwt-access-secret');
    expect(calledNames).toContain('jwt-refresh-secret');
    expect(calledNames).toContain('db-password');
    expect(calledNames).toContain('db-app-password');
    expect(calledNames).toContain('redis-url');
    // Every SENSITIVE_KEY gets exactly one lookup.
    expect(getSecretMock).toHaveBeenCalledTimes(_SENSITIVE_KEYS.length);
  });

  it('writes returned secret values into process.env and returns loadedCount', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.DB_APP_PASSWORD;
    getSecretMock.mockImplementation(async (name: string) => {
      if (name === 'jwt-access-secret') return { value: 'vault-jwt-secret-value-long-enough-for-validators' };
      if (name === 'db-app-password') return { value: 'vault-db-pw' };
      // Every other secret is "not found" — the normal partial-population case.
      throw Object.assign(new Error('nf'), { code: 'SecretNotFound' });
    });
    const r = await loadSecretsAsync();
    expect(r.backend).toBe('azure_keyvault');
    expect(r.loadedCount).toBe(2);
    expect(process.env.JWT_ACCESS_SECRET).toBe('vault-jwt-secret-value-long-enough-for-validators');
    expect(process.env.DB_APP_PASSWORD).toBe('vault-db-pw');
  });

  it('silently skips SecretNotFound and leaves existing env vars untouched', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    process.env.JWT_ACCESS_SECRET = 'pre-existing-env-value';
    getSecretMock.mockRejectedValue(Object.assign(new Error('nf'), { code: 'SecretNotFound' }));
    const r = await loadSecretsAsync();
    expect(r.loadedCount).toBe(0);
    expect(process.env.JWT_ACCESS_SECRET).toBe('pre-existing-env-value');
  });

  it('throws on non-SecretNotFound errors (auth / network)', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    getSecretMock.mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'Forbidden' }));
    await expect(loadSecretsAsync()).rejects.toThrow(/azure_keyvault.*forbidden/);
  });

  it('delegates to sync loadSecrets() when SECRETS_BACKEND !== azure_keyvault', async () => {
    process.env.SECRETS_BACKEND = 'env';
    delete process.env.AZURE_KEYVAULT_URL;
    const r = await loadSecretsAsync();
    expect(r.backend).toBe('env');
    expect(r.loadedCount).toBe(0);
    // Azure SDK was never touched.
    expect(SecretClientCtor).not.toHaveBeenCalled();
    expect(DefaultAzureCredentialCtor).not.toHaveBeenCalled();
  });

  it('includes PHI_ENCRYPTION_KEY + BLIND_INDEX_KEY in SENSITIVE_KEYS (L4 BLOCK absorb)', () => {
    // Without these in the allowlist, SECRETS_BACKEND=azure_keyvault on
    // non-App-Service hosts silently runs with PHI encryption off.
    expect(_SENSITIVE_KEYS).toContain('PHI_ENCRYPTION_KEY');
    expect(_SENSITIVE_KEYS).toContain('BLIND_INDEX_KEY');
    expect(_SENSITIVE_KEYS).toContain('SESSION_SECRET');
    expect(_SENSITIVE_KEYS).toContain('CALENDAR_ICAL_SECRET');
    expect(_SENSITIVE_KEYS).toContain('SIGNACARE_LICENSE_SECRET');
  });

  it('enforces REQUIRED_IN_PRODUCTION — throws when JWT_ACCESS_SECRET missing in prod', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    process.env.NODE_ENV = 'production';
    // Make sure the required keys are NOT in env.
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DB_APP_PASSWORD', 'BLIND_INDEX_KEY', 'PATIENT_APP_DEDUPE_PEPPER']) {
      delete process.env[k];
    }
    // Every vault lookup returns SecretNotFound so nothing lands in env.
    getSecretMock.mockRejectedValue(Object.assign(new Error('nf'), { code: 'SecretNotFound' }));
    await expect(loadSecretsAsync()).rejects.toThrow(/REQUIRED_IN_PRODUCTION.*missing/);
  });

  it('enforces REQUIRED_IN_PRODUCTION — passes when every required key is populated', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    process.env.NODE_ENV = 'production';
    getSecretMock.mockImplementation(async (name: string) => {
      const map: Record<string, string> = {
        'jwt-access-secret': 'x'.repeat(64),
        'jwt-refresh-secret': 'y'.repeat(64),
        'db-app-password': 'test-db-pw',
        'phi-encryption-key': 'a'.repeat(64),
        'blind-index-key': 'b'.repeat(64),
        'patient-app-dedupe-pepper': 'patient-dedupe-pepper-test',
      };
      if (map[name]) return { value: map[name] };
      throw Object.assign(new Error('nf'), { code: 'SecretNotFound' });
    });
    await expect(loadSecretsAsync()).resolves.toBeTruthy();
  });

  it('REQUIRED_IN_PRODUCTION is skipped in non-production (NODE_ENV=test)', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    process.env.NODE_ENV = 'test';
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DB_APP_PASSWORD', 'BLIND_INDEX_KEY', 'PATIENT_APP_DEDUPE_PEPPER']) {
      delete process.env[k];
    }
    getSecretMock.mockRejectedValue(Object.assign(new Error('nf'), { code: 'SecretNotFound' }));
    // No throw — test/dev tolerates missing keys.
    await expect(loadSecretsAsync()).resolves.toBeTruthy();
  });

  it('never writes an env var outside the SENSITIVE_KEYS allowlist', async () => {
    process.env.SECRETS_BACKEND = 'azure_keyvault';
    process.env.AZURE_KEYVAULT_URL = 'https://test-kv.vault.azure.net';
    const beforePort = process.env.PORT;
    const beforeNodeEnv = process.env.NODE_ENV;
    // The mock would return a value for ANY secret name — but the
    // resolver only asks for SENSITIVE_KEYS, so PORT / NODE_ENV are
    // never queried and never overwritten.
    getSecretMock.mockResolvedValue({ value: 'should-not-be-applied' });
    await loadSecretsAsync();
    const calledNames = getSecretMock.mock.calls.map((c) => c[0]);
    expect(calledNames).not.toContain('port');
    expect(calledNames).not.toContain('node-env');
    expect(process.env.PORT).toBe(beforePort);
    expect(process.env.NODE_ENV).toBe(beforeNodeEnv);
  });
});

describe('BUG-366a L5 absorb — production boot entry points route via index.ts', () => {
  // Without this, `npm start` in production runs dist/src/server.js
  // directly — bypassing index.ts and its async Key Vault resolution.
  // The fix is at the deploy layer (package.json, Dockerfile, pm2)
  // and must be pinned by static assertions so nobody can silently
  // revert them.
  it('apps/api/package.json "start" points at dist/src/index.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.start || pkg.scripts?.start).toMatch(/dist\/src\/index\.js/);
  });

  it('apps/api/package.json "main" points at dist/src/index.js', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.main).toBe('dist/src/index.js');
  });

  it('apps/api/Dockerfile boots through entrypoint.sh and entrypoint launches dist/src/index.js', () => {
    const df = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
    const entrypoint = fs.readFileSync(path.join(__dirname, '..', 'entrypoint.sh'), 'utf8');
    expect(df).toMatch(/ENTRYPOINT \["\.\/entrypoint\.sh"\]/);
    expect(entrypoint).toMatch(/exec node -r dotenv\/config dist\/src\/index\.js/);
    expect(entrypoint).not.toMatch(/dist\/src\/server\.js/);
  });

  it('apps/api/src/index.ts awaits loadSecretsAsync', () => {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
    expect(idx).toMatch(/await loadSecretsAsync\(\)/);
    expect(idx).toMatch(/import\(['"]\.\/server['"]\)/);
  });
});
