/**
 * S4.1 — secrets resolver unit tests
 *
 * Tests the loadSecrets() pre-process step in isolation. Uses tmpdir
 * for the file backend; manipulates process.env in beforeEach for
 * the env+json paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSecrets, getSecretsBackendName, _SENSITIVE_KEYS } from '../src/config/secrets';

const ORIGINAL_ENV: Record<string, string | undefined> = {};

function snapshotEnv(): void {
  for (const key of _SENSITIVE_KEYS) ORIGINAL_ENV[key] = process.env[key];
  ORIGINAL_ENV['SECRETS_BACKEND'] = process.env.SECRETS_BACKEND;
  ORIGINAL_ENV['SECRETS_JSON'] = process.env.SECRETS_JSON;
  ORIGINAL_ENV['SECRETS_FILE_PATH'] = process.env.SECRETS_FILE_PATH;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => snapshotEnv());
afterEach(() => restoreEnv());

describe('getSecretsBackendName', () => {
  it('defaults to env when unset', () => {
    delete process.env.SECRETS_BACKEND;
    expect(getSecretsBackendName()).toBe('env');
  });
  it('accepts env, json, file', () => {
    process.env.SECRETS_BACKEND = 'json';
    expect(getSecretsBackendName()).toBe('json');
    process.env.SECRETS_BACKEND = 'file';
    expect(getSecretsBackendName()).toBe('file');
  });
  it('falls back to env on unknown value', () => {
    process.env.SECRETS_BACKEND = 'vault';
    expect(getSecretsBackendName()).toBe('env');
  });
});

describe('loadSecrets — env backend', () => {
  it('is a no-op (loadedCount=0)', () => {
    delete process.env.SECRETS_BACKEND;
    const r = loadSecrets();
    expect(r.backend).toBe('env');
    expect(r.loadedCount).toBe(0);
  });
});

describe('loadSecrets — json backend', () => {
  it('throws when SECRETS_JSON is missing', () => {
    process.env.SECRETS_BACKEND = 'json';
    delete process.env.SECRETS_JSON;
    expect(() => loadSecrets()).toThrow(/SECRETS_JSON/);
  });

  it('overwrites only the keys in the allowlist', () => {
    process.env.SECRETS_BACKEND = 'json';
    process.env.SECRETS_JSON = JSON.stringify({
      JWT_ACCESS_SECRET: 'a-very-long-jwt-secret-from-secret-store-x'.padEnd(64, '_'),
      DB_PASSWORD: 'db-secret-password',
      // Not in the allowlist — must NOT be applied
      PORT: '9999',
    });
    const r = loadSecrets();
    expect(r.backend).toBe('json');
    expect(r.loadedCount).toBe(2);
    expect(process.env.JWT_ACCESS_SECRET).toContain('a-very-long-jwt-secret');
    expect(process.env.DB_PASSWORD).toBe('db-secret-password');
    // PORT should be unchanged from before the call
    expect(process.env.PORT).not.toBe('9999');
  });

  it('throws when SECRETS_JSON is not a valid JSON object', () => {
    process.env.SECRETS_BACKEND = 'json';
    process.env.SECRETS_JSON = '[1, 2, 3]';
    expect(() => loadSecrets()).toThrow();
  });

  it('throws on malformed JSON', () => {
    process.env.SECRETS_BACKEND = 'json';
    process.env.SECRETS_JSON = '{not json';
    expect(() => loadSecrets()).toThrow();
  });
});

describe('loadSecrets — file backend', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `signacare-secrets-test-${Date.now()}.json`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch { /* best-effort */ }
  });

  it('loads keys from a JSON file', () => {
    fs.writeFileSync(tmpFile, JSON.stringify({
      DB_PASSWORD: 'from-file',
      JWT_REFRESH_SECRET: 'refresh-secret-from-the-file-loaded-by-the-resolver',
    }));
    process.env.SECRETS_BACKEND = 'file';
    process.env.SECRETS_FILE_PATH = tmpFile;
    const r = loadSecrets();
    expect(r.backend).toBe('file');
    expect(r.loadedCount).toBe(2);
    expect(process.env.DB_PASSWORD).toBe('from-file');
  });

  it('throws when SECRETS_FILE_PATH is missing', () => {
    process.env.SECRETS_BACKEND = 'file';
    delete process.env.SECRETS_FILE_PATH;
    expect(() => loadSecrets()).toThrow(/SECRETS_FILE_PATH/);
  });

  it('throws when the file does not exist', () => {
    process.env.SECRETS_BACKEND = 'file';
    process.env.SECRETS_FILE_PATH = path.join(os.tmpdir(), 'no-such-file-' + Date.now());
    expect(() => loadSecrets()).toThrow(/file not found/);
  });
});

describe('SENSITIVE_KEYS allow-list', () => {
  it('contains the critical secret env vars', () => {
    expect(_SENSITIVE_KEYS).toContain('JWT_ACCESS_SECRET');
    expect(_SENSITIVE_KEYS).toContain('JWT_REFRESH_SECRET');
    expect(_SENSITIVE_KEYS).toContain('DB_PASSWORD');
    expect(_SENSITIVE_KEYS).toContain('BLOB_S3_SECRET_ACCESS_KEY');
    expect(_SENSITIVE_KEYS).toContain('SENTRY_DSN');
  });

  it('does NOT contain non-sensitive config like PORT or NODE_ENV', () => {
    expect(_SENSITIVE_KEYS).not.toContain('PORT');
    expect(_SENSITIVE_KEYS).not.toContain('NODE_ENV');
    expect(_SENSITIVE_KEYS).not.toContain('CORS_ORIGIN');
  });
});
