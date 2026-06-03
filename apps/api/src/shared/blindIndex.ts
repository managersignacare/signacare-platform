// apps/api/src/shared/blindIndex.ts
//
// Deterministic blind indexes for encrypted healthcare identifiers.
//
// Problem: Medicare / IHI / DVA numbers are encrypted at rest with
// AES-256-GCM + random IV (apps/api/src/shared/phiEncryption.ts). Two
// copies of the same Medicare number therefore produce different
// ciphertexts, so we cannot ask PostgreSQL "does any patient in this
// clinic have Medicare X?" via a simple equality query.
//
// Solution: store an HMAC-SHA-256 of the normalised plaintext next to
// the ciphertext column. The HMAC is deterministic (same input -> same
// output) so we CAN equality-query it, but it is a cryptographic one-way
// function so an attacker with DB access alone cannot recover the
// plaintext without also compromising the BLIND_INDEX_KEY.
//
// Key management:
//   - BLIND_INDEX_KEY env var (64-char hex = 32 bytes, min 32 chars)
//   - Generate with: openssl rand -hex 32
//   - Must be DIFFERENT from PHI_ENCRYPTION_KEY — see separation of
//     duties guidance in NIST SP 800-57 Part 1 §8.2.3
//   - Rotating this key is expensive (full re-HMAC of every patient row)
//     so it must be treated as long-lived key material and stored in
//     the same KMS as PHI_ENCRYPTION_KEY with a distinct alias
//
// Wire format: plain hex string (64 chars). Fixed length simplifies
// schema-level UNIQUE indexing.
//
// Why HMAC and not plain SHA-256?
//   A plain hash would let an attacker with DB access plus the public
//   Medicare number space (10-11 digits, ~100B values) brute-force the
//   table in a few CPU-hours. HMAC with a secret key defeats that
//   attack — without the key the attacker has no correlation between
//   stored hash and guessed plaintext.
//
// Fix Registry: BI1 (blind-index helper exported), BI2 (key separation
// enforced — throws if BLIND_INDEX_KEY matches PHI_ENCRYPTION_KEY).

import { createHmac } from 'crypto';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.BLIND_INDEX_KEY;
  if (!hex || hex.length < 32) {
    throw new Error(
      'BLIND_INDEX_KEY not set or too short (need 32+ hex chars). Generate with: openssl rand -hex 32',
    );
  }
  // Security check: the blind-index key MUST differ from the PHI
  // encryption key. If they are the same, a compromise of one means a
  // compromise of the other — violates NIST SP 800-57 §8.2.3.
  const phiKey = process.env.PHI_ENCRYPTION_KEY;
  if (phiKey && phiKey === hex) {
    throw new Error(
      'BLIND_INDEX_KEY must differ from PHI_ENCRYPTION_KEY. Rotate one of them with: openssl rand -hex 32',
    );
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/**
 * Normalise an identifier before hashing. The same input must always
 * normalise to the same output otherwise two legitimately-identical
 * values would hash differently and duplicate detection would break.
 *
 * Rules (applied in order):
 *   1. Trim
 *   2. Lowercase (Medicare / IHI / DVA are digits only, but we normalise
 *      anyway in case someone typed a letter O as zero etc.)
 *   3. Remove every character that is not [a-z0-9]
 *
 * Returns null for empty input — caller stores NULL, not an HMAC of empty
 * string.
 */
export function normaliseIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * Compute the blind index for a healthcare identifier. Returns null if
 * the value is empty after normalisation — callers should store NULL in
 * the database, not an HMAC of an empty string.
 *
 * The `type` argument is mixed into the HMAC domain so the same digit
 * string cannot match across Medicare / IHI / DVA columns. This is
 * important because IHI is 16 digits (cannot collide with 10-11-digit
 * Medicare) but it's defence in depth.
 */
export function computeBlindIndex(
  value: string | null | undefined,
  type: 'medicare' | 'ihi' | 'dva',
): string | null {
  const normalised = normaliseIdentifier(value);
  if (!normalised) return null;
  const domained = `${type}:${normalised}`;
  return createHmac('sha256', getKey()).update(domained).digest('hex');
}

/**
 * Convenience: compute all three blind indexes at once for a patient row
 * being inserted or updated.
 */
export function computePatientBlindIndexes(input: {
  medicareNumber?: string | null;
  ihiNumber?: string | null;
  dvaNumber?: string | null;
}): {
  medicare_number_lookup: string | null;
  ihi_number_lookup: string | null;
  dva_number_lookup: string | null;
} {
  return {
    medicare_number_lookup: computeBlindIndex(input.medicareNumber, 'medicare'),
    ihi_number_lookup: computeBlindIndex(input.ihiNumber, 'ihi'),
    dva_number_lookup: computeBlindIndex(input.dvaNumber, 'dva'),
  };
}

/** Test-only: clear the cached key between unit tests that set the env var. */
export function __resetBlindIndexKeyForTests(): void {
  cachedKey = null;
}
