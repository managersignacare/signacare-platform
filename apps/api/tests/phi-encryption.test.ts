// tests/phi-encryption.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptPhi,
  decryptPhi,
  encryptPatientPhi,
  decryptPatientPhi,
  isPhiEncryptionEnabled,
  PhiCryptoError,
} from '../src/shared/phiEncryption';
import { decryptPhi as decryptPhiUtil } from '../src/utils/phiEncryption';

describe('PHI Encryption', () => {
  beforeAll(() => {
    // Ensure test has a key
    if (!process.env.PHI_ENCRYPTION_KEY || process.env.PHI_ENCRYPTION_KEY.length < 64) {
      process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
    }
  });

  it('encrypts and decrypts a Medicare number', () => {
    const medicare = '2345678901';
    const encrypted = encryptPhi(medicare);
    expect(encrypted).not.toBe(medicare);
    expect(encrypted).toContain(':'); // keyVersion:iv:tag:ciphertext format
    const decrypted = decryptPhi(encrypted);
    expect(decrypted).toBe(medicare);
  });

  it('returns null for null/undefined input', () => {
    expect(encryptPhi(null)).toBeNull();
    expect(encryptPhi(undefined)).toBeNull();
    expect(decryptPhi(null)).toBeNull();
    expect(decryptPhi(undefined)).toBeNull();
  });

  it('produces different ciphertext each time (random IV)', () => {
    const value = '1234567890';
    const a = encryptPhi(value);
    const b = encryptPhi(value);
    expect(a).not.toBe(b); // Different IVs
    expect(decryptPhi(a)).toBe(value);
    expect(decryptPhi(b)).toBe(value);
  });

  it('decrypts plaintext passthrough (not encrypted)', () => {
    const plain = '0412345678';
    // No colons means not encrypted — should return as-is
    expect(decryptPhi(plain)).toBe(plain);
  });

  it('encrypts/decrypts patient PHI fields', () => {
    const patient = {
      id: '123',
      given_name: 'John',
      family_name: 'Smith',
      medicare_number: '2345678901',
      ihi_number: '8003608166690503',
      dva_number: 'QSS12345',
      phone_mobile: '0412345678',
      email_primary: 'john@test.com',
    };

    const encrypted = encryptPatientPhi(patient);
    expect(encrypted.given_name).toBe('John'); // Not a PHI field
    expect(encrypted.family_name).toBe('Smith'); // Not a PHI field
    expect(encrypted.medicare_number).not.toBe('2345678901');
    expect(encrypted.ihi_number).not.toBe('8003608166690503');
    expect(encrypted.phone_mobile).not.toBe('0412345678');

    const decrypted = decryptPatientPhi(encrypted);
    expect(decrypted.medicare_number).toBe('2345678901');
    expect(decrypted.ihi_number).toBe('8003608166690503');
    expect(decrypted.dva_number).toBe('QSS12345');
    expect(decrypted.phone_mobile).toBe('0412345678');
    expect(decrypted.email_primary).toBe('john@test.com');
  });

  it('reports encryption enabled', () => {
    expect(isPhiEncryptionEnabled()).toBe(true);
  });
});

// BUG-441 — fail-fast on encrypt/decrypt failure (P0 SECURITY).
// Silent fallback to plaintext / ciphertext is forbidden; every failure
// MUST throw PhiCryptoError so callers see a 500 rather than a silent
// plaintext write.
describe('PHI Encryption — fail-fast (BUG-441)', () => {
  beforeAll(() => {
    if (!process.env.PHI_ENCRYPTION_KEY || process.env.PHI_ENCRYPTION_KEY.length < 64) {
      process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
    }
  });

  it('decryptPhi throws PhiCryptoError on tampered ciphertext (auth-tag mismatch)', () => {
    const value = '2345678901';
    const encrypted = encryptPhi(value)!;
    // Tamper the ciphertext portion — auth-tag verification must fail.
    // Format: keyVersion:iv:tag:ciphertext
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('tampered-payload').toString('base64')}`;
    expect(() => decryptPhi(tampered)).toThrow(PhiCryptoError);
    try {
      decryptPhi(tampered);
    } catch (err) {
      expect(err).toBeInstanceOf(PhiCryptoError);
      expect((err as PhiCryptoError).op).toBe('decrypt');
    }
  });

  it('decryptPhi returns legacy plaintext unchanged when the input does NOT look encrypted (no 3-part colons)', () => {
    // Legacy compat: plaintext values stored before encryption was enabled
    // pass through; only iv:tag:ciphertext-formatted inputs go through decrypt
    expect(decryptPhi('plain-text-no-colons')).toBe('plain-text-no-colons');
    expect(decryptPhi('only:two:colons:four')).toBe('only:two:colons:four');
  });

  it('decryptPhi passes through malformed short 3-part payloads as legacy plaintext', () => {
    const garbage = `${Buffer.from('aa').toString('base64')}:${Buffer.from('bb').toString('base64')}:${Buffer.from('cc').toString('base64')}`;
    expect(decryptPhi(garbage)).toBe(garbage);
  });

  it('utils/phiEncryption decryptPhi throws on tampered ciphertext (BUG-441 duplicate fix)', () => {
    const encrypted = encryptPhi('utility-path-test')!;
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('tampered').toString('base64')}`;
    expect(() => decryptPhiUtil(tampered)).toThrow();
  });

  it('PhiCryptoError carries op + reason + cause for operator triage', () => {
    const encrypted = encryptPhi('triage-test-value')!;
    const parts = encrypted.split(':');
    const garbage = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('tampered-bytes').toString('base64')}`;
    try {
      decryptPhi(garbage);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PhiCryptoError);
      const phiErr = err as PhiCryptoError;
      expect(phiErr.op).toBe('decrypt');
      expect(phiErr.reason).toMatch(/bad_(tag|format|internal)/);
      expect(phiErr.cause).toBeDefined();
    }
  });

});
// Note: the L3 reviewer advised adding a `reason === 'bad_key'` assertion via
// a wrong-length key. The shared module caches the key on first call, and
// the utils module falls back to a deterministic dev key in NODE_ENV=test,
// so exercising the bad_key path cleanly requires module-reload plumbing
// beyond BUG-441's scope. Captured in the follow-up BUG-483 consolidation.
