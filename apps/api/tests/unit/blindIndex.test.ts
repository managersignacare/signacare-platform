// S7.1 — Unit tests for the blind-index helper.
//
// These tests run without a database: the helper is pure crypto over
// the process env. We exercise the contract that matters for duplicate
// detection:
//
//   1. Same plaintext + same key -> same HMAC (deterministic)
//   2. Different plaintext -> different HMAC
//   3. Key separation from PHI_ENCRYPTION_KEY is enforced
//   4. Whitespace / case / non-alphanumeric normalisation collapses
//      legitimately-equal variants
//   5. Domain separation between medicare / ihi / dva
//   6. null / empty input -> null output (not an HMAC of empty string)
//
// No PHI values are used; all fixtures are synthetic test numbers
// chosen to match the length of real identifiers but not clash with any
// issued range.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeBlindIndex,
  computePatientBlindIndexes,
  normaliseIdentifier,
  __resetBlindIndexKeyForTests,
} from '../../src/shared/blindIndex';

const TEST_KEY = 'a'.repeat(64); // 32-byte key in hex
const OTHER_KEY = 'b'.repeat(64);

beforeEach(() => {
  process.env.BLIND_INDEX_KEY = TEST_KEY;
  delete process.env.PHI_ENCRYPTION_KEY;
  __resetBlindIndexKeyForTests();
});

afterEach(() => {
  delete process.env.BLIND_INDEX_KEY;
  delete process.env.PHI_ENCRYPTION_KEY;
  __resetBlindIndexKeyForTests();
});

describe('blindIndex.normaliseIdentifier', () => {
  it('strips whitespace and hyphens', () => {
    expect(normaliseIdentifier(' 1234 5678 9 ')).toBe('123456789');
    expect(normaliseIdentifier('1234-5678-9')).toBe('123456789');
  });

  it('lowercases alphabetic characters', () => {
    expect(normaliseIdentifier('ABC123')).toBe('abc123');
  });

  it('drops punctuation', () => {
    expect(normaliseIdentifier('1234.5678/9')).toBe('123456789');
  });

  it('returns null for empty / whitespace / punctuation-only input', () => {
    expect(normaliseIdentifier(null)).toBeNull();
    expect(normaliseIdentifier(undefined)).toBeNull();
    expect(normaliseIdentifier('')).toBeNull();
    expect(normaliseIdentifier('   ')).toBeNull();
    expect(normaliseIdentifier('---')).toBeNull();
  });
});

describe('blindIndex.computeBlindIndex', () => {
  it('returns the same hash for the same plaintext', () => {
    const a = computeBlindIndex('1234567890', 'medicare');
    const b = computeBlindIndex('1234567890', 'medicare');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats whitespace / punctuation variants as equal', () => {
    expect(computeBlindIndex('1234 5678 90', 'medicare')).toBe(
      computeBlindIndex('1234-5678-90', 'medicare'),
    );
    expect(computeBlindIndex('1234567890', 'medicare')).toBe(
      computeBlindIndex('  1234567890  ', 'medicare'),
    );
  });

  it('produces different hashes for different plaintext', () => {
    const a = computeBlindIndex('1234567890', 'medicare');
    const b = computeBlindIndex('1234567891', 'medicare');
    expect(a).not.toBe(b);
  });

  it('domain-separates medicare, ihi, and dva', () => {
    // Same digits under different type -> different hash because we
    // prefix the HMAC input with the type name.
    const m = computeBlindIndex('1234567890', 'medicare');
    const i = computeBlindIndex('1234567890', 'ihi');
    const d = computeBlindIndex('1234567890', 'dva');
    expect(m).not.toBe(i);
    expect(i).not.toBe(d);
    expect(m).not.toBe(d);
  });

  it('returns null for null / empty input', () => {
    expect(computeBlindIndex(null, 'medicare')).toBeNull();
    expect(computeBlindIndex(undefined, 'medicare')).toBeNull();
    expect(computeBlindIndex('', 'medicare')).toBeNull();
    expect(computeBlindIndex('   ', 'medicare')).toBeNull();
  });

  it('produces different output when the key changes', () => {
    const a = computeBlindIndex('1234567890', 'medicare');
    process.env.BLIND_INDEX_KEY = OTHER_KEY;
    __resetBlindIndexKeyForTests();
    const b = computeBlindIndex('1234567890', 'medicare');
    expect(a).not.toBe(b);
  });
});

describe('blindIndex key-separation guard', () => {
  it('throws if BLIND_INDEX_KEY equals PHI_ENCRYPTION_KEY', () => {
    process.env.BLIND_INDEX_KEY = TEST_KEY;
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
    __resetBlindIndexKeyForTests();
    expect(() => computeBlindIndex('1234567890', 'medicare')).toThrow(/must differ/);
  });

  it('throws if BLIND_INDEX_KEY is missing or too short', () => {
    delete process.env.BLIND_INDEX_KEY;
    __resetBlindIndexKeyForTests();
    expect(() => computeBlindIndex('1234567890', 'medicare')).toThrow(/BLIND_INDEX_KEY/);

    process.env.BLIND_INDEX_KEY = 'short';
    __resetBlindIndexKeyForTests();
    expect(() => computeBlindIndex('1234567890', 'medicare')).toThrow(/BLIND_INDEX_KEY/);
  });
});

describe('blindIndex.computePatientBlindIndexes', () => {
  it('handles a full patient record', () => {
    const out = computePatientBlindIndexes({
      medicareNumber: '1234567890',
      ihiNumber: '8003600000000000',
      dvaNumber: 'V123456',
    });
    expect(out.medicare_number_lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(out.ihi_number_lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(out.dva_number_lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(out.medicare_number_lookup).not.toBe(out.ihi_number_lookup);
  });

  it('returns null fields when the corresponding plaintext is missing', () => {
    const out = computePatientBlindIndexes({ medicareNumber: '1234567890' });
    expect(out.medicare_number_lookup).toMatch(/^[0-9a-f]{64}$/);
    expect(out.ihi_number_lookup).toBeNull();
    expect(out.dva_number_lookup).toBeNull();
  });
});
