import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const forwardFixPath = join(
  repoRoot,
  'apps/api/migrations/20260701000101_bug_240_registration_requests_forward_fix.ts',
);
const createMigrationPath = join(
  repoRoot,
  'apps/api/migrations/20260701000099_bug_240_patient_app_registration_requests.ts',
);

function extractConstString(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} =\\s*'([^']+)'`));
  if (!match?.[1]) throw new Error(`Unable to extract ${name}`);
  return match[1];
}

function hasOnlyAllowedJsonPhiKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => key === 'encoding' || key === 'ciphertext');
}

describe('patient-app registration migration PHI guard', () => {
  it('fails closed with structured encrypted-PHI checks, not substring heuristics', () => {
    const source = readFileSync(forwardFixPath, 'utf8');

    expect(source).toContain('jsonb_object_keys');
    expect(source).toContain('phi-aes-256-gcm-json-v1');
    expect(source).toContain('[A-Za-z0-9+/]{20,}');
    expect(source).not.toContain('%"ciphertext"%');
    expect(source).not.toContain('NOT LIKE');
    expect(source).not.toContain('[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+');
  });

  it('executes the forward-fix encrypted string guard against weak and valid cases', () => {
    const source = readFileSync(forwardFixPath, 'utf8');
    const encryptedPhiPattern = new RegExp(extractConstString(source, 'ENCRYPTED_PHI_PATTERN'));

    expect(encryptedPhiPattern.test('foo:bar:baz')).toBe(false);
    expect(encryptedPhiPattern.test('not encrypted prose with spaces')).toBe(false);
    expect(encryptedPhiPattern.test('clinic:viva-registration-plaintext')).toBe(false);

    const strongCiphertext = `${'A'.repeat(24)}:${'B'.repeat(24)}:${'C'.repeat(24)}`;
    const versionedStrongCiphertext = `v1:${'A'.repeat(24)}:${'B'.repeat(24)}:${'C'.repeat(24)}`;
    expect(encryptedPhiPattern.test(strongCiphertext)).toBe(true);
    expect(encryptedPhiPattern.test(versionedStrongCiphertext)).toBe(true);
  });

  it('executes the forward-fix JSON PHI shape guard against fake ciphertext and extra fields', () => {
    const source = readFileSync(forwardFixPath, 'utf8');
    const encryptedPhiPattern = new RegExp(extractConstString(source, 'ENCRYPTED_PHI_PATTERN'));
    const encoding = extractConstString(source, 'JSON_PHI_ENCODING');
    const validJsonPhi = {
      encoding,
      ciphertext: `${'A'.repeat(24)}:${'B'.repeat(24)}:${'C'.repeat(24)}`,
    };
    const acceptsJsonPhi = (value: Record<string, unknown>): boolean =>
      hasOnlyAllowedJsonPhiKeys(value) &&
      value.encoding === encoding &&
      typeof value.ciphertext === 'string' &&
      encryptedPhiPattern.test(value.ciphertext);

    expect(acceptsJsonPhi(validJsonPhi)).toBe(true);
    expect(acceptsJsonPhi({ encoding, ciphertext: 'foo:bar:baz' })).toBe(false);
    expect(acceptsJsonPhi({ encoding, ciphertext: 'not encrypted prose' })).toBe(false);
    expect(acceptsJsonPhi({ encoding: 'wrong-encoding', ciphertext: validJsonPhi.ciphertext })).toBe(false);
    expect(acceptsJsonPhi({ ...validJsonPhi, suburb: 'Melbourne' })).toBe(false);
    expect(acceptsJsonPhi({ ciphertext: validJsonPhi.ciphertext })).toBe(false);
  });

  it('annotates RLS and trigger raw SQL blocks separately', () => {
    const source = readFileSync(createMigrationPath, 'utf8');

    expect(source).toContain('@migration-raw-exempt: rls_policy');
    expect(source).toContain('@migration-raw-exempt: trigger_drop');
    expect(source).toContain('@migration-raw-exempt: trigger_create');
  });
});
