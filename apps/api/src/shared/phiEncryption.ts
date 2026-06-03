// apps/api/src/shared/phiEncryption.ts
//
// AES-256-GCM encryption for Protected Health Information (PHI).
// Used for: Medicare numbers, IHI numbers, DVA numbers, and other
// healthcare identifiers that must be encrypted at rest per
// Australian Privacy Act 1988 and My Health Records Act 2012.
//
// Key management:
//   - Legacy single-key env: PHI_ENCRYPTION_KEY (64-char hex = 32 bytes)
//   - Rotation-ready keyring env:
//       PHI_ENCRYPTION_KEYRING_JSON='{"v1":"<hex>", "v2":"<hex>"}'
//       PHI_ENCRYPTION_ACTIVE_KEY_VERSION='v2'
//   - Generate keys with: openssl rand -hex 32
//
// Storage format:
//   - Versioned: "keyVersion:iv:tag:ciphertext" (all base64 except version)
//   - Legacy:    "iv:tag:ciphertext" (3-part, assumed v1)
//
// This is deterministic per-field but uses random IVs, so the same
// plaintext produces different ciphertext each time (no rainbow tables).

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { logger } from '../utils/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const ENCODING = 'base64' as const;

/**
 * Typed error thrown by PHI encrypt/decrypt failures.
 * BUG-441: replaces silent plaintext/ciphertext fallback which was a P0
 * security gap (wrong-length key / auth-tag mismatch → silent plaintext
 * write to ENCRYPTED columns). Every PHI crypto failure is now observable
 * via a logger.error + a typed exception that propagates to the request
 * error middleware → 500. Azure Monitor can alert on `kind=PhiCryptoError`.
 */
export class PhiCryptoError extends Error {
  public readonly cause: unknown;
  constructor(
    public readonly op: 'encrypt' | 'decrypt',
    public readonly reason: 'bad_key' | 'bad_tag' | 'bad_format' | 'internal',
    cause: unknown,
  ) {
    super(`PHI ${op} failed: ${reason}`);
    this.name = 'PhiCryptoError';
    this.cause = cause;
  }
}

type PhiKeyRing = {
  activeVersion: string;
  keys: Map<string, Buffer>;
};

let keyRingCache: PhiKeyRing | null = null;

function parseHexKey(hex: string, label: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(hex)) {
    throw new Error(`${label} must be a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}

function normalizeVersion(raw: string, label: string): string {
  const value = raw.trim();
  if (!value) throw new Error(`${label} is empty`);
  if (value.includes(':')) throw new Error(`${label} must not contain ':'`);
  return value;
}

function loadKeyRing(): PhiKeyRing {
  if (keyRingCache) return keyRingCache;

  const keys = new Map<string, Buffer>();
  const keyringRaw = process.env.PHI_ENCRYPTION_KEYRING_JSON?.trim();
  if (keyringRaw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(keyringRaw);
    } catch (err) {
      throw new Error(`PHI_ENCRYPTION_KEYRING_JSON is not valid JSON: ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('PHI_ENCRYPTION_KEYRING_JSON must be a JSON object {version: hexKey}');
    }
    for (const [versionRaw, keyRaw] of Object.entries(parsed)) {
      if (typeof keyRaw !== 'string') {
        throw new Error(`PHI_ENCRYPTION_KEYRING_JSON[${versionRaw}] must be a string`);
      }
      const version = normalizeVersion(versionRaw, `PHI_ENCRYPTION_KEYRING_JSON key "${versionRaw}"`);
      keys.set(version, parseHexKey(keyRaw, `PHI_ENCRYPTION_KEYRING_JSON["${version}"]`));
    }
  }

  // Backward-compatible fallback to the legacy single-key env.
  if (keys.size === 0) {
    const legacy = process.env.PHI_ENCRYPTION_KEY?.trim();
    if (legacy) {
      keys.set('v1', parseHexKey(legacy, 'PHI_ENCRYPTION_KEY'));
    }
  }

  if (keys.size === 0) {
    throw new Error('No PHI key configured (set PHI_ENCRYPTION_KEY or PHI_ENCRYPTION_KEYRING_JSON)');
  }

  const requestedActive = process.env.PHI_ENCRYPTION_ACTIVE_KEY_VERSION?.trim();
  const activeVersion = requestedActive
    ? normalizeVersion(requestedActive, 'PHI_ENCRYPTION_ACTIVE_KEY_VERSION')
    : (keys.has('v1') ? 'v1' : Array.from(keys.keys())[0]!);

  const activeKey = keys.get(activeVersion);
  if (!activeKey) {
    throw new Error(
      `PHI_ENCRYPTION_ACTIVE_KEY_VERSION="${activeVersion}" not found in configured PHI keyring`,
    );
  }

  keyRingCache = { activeVersion, keys };
  return keyRingCache;
}

function getActiveKey(): { version: string; key: Buffer } {
  const ring = loadKeyRing();
  const key = ring.keys.get(ring.activeVersion);
  if (!key) throw new Error(`Active PHI key version "${ring.activeVersion}" is missing`);
  return { version: ring.activeVersion, key };
}

function getKeyForVersion(version: string): Buffer {
  const ring = loadKeyRing();
  const key = ring.keys.get(version);
  if (!key) {
    throw new Error(
      `PHI key version "${version}" is not configured (rotation keyring mismatch)`,
    );
  }
  return key;
}

function getAllConfiguredKeys(): Buffer[] {
  const ring = loadKeyRing();
  return Array.from(ring.keys.values());
}

function tryDecryptLegacyPackedBlob(ciphertext: string): string | undefined {
  // Legacy util/phiEncryption format: base64(iv[12] + ciphertext + tag[16]).
  // We only attempt this path for strict base64 payloads of plausible size.
  if (!/^[A-Za-z0-9+/=]+$/.test(ciphertext) || ciphertext.length % 4 !== 0) {
    return undefined;
  }
  const packed = Buffer.from(ciphertext, ENCODING);
  const LEGACY_IV_LEN = 12;
  const LEGACY_TAG_LEN = 16;
  if (packed.length < LEGACY_IV_LEN + LEGACY_TAG_LEN + 1) {
    return undefined;
  }

  const iv = packed.subarray(0, LEGACY_IV_LEN);
  const tag = packed.subarray(packed.length - LEGACY_TAG_LEN);
  const encrypted = packed.subarray(LEGACY_IV_LEN, packed.length - LEGACY_TAG_LEN);
  const keys = getAllConfiguredKeys();
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      // Try next key in keyring.
    }
  }
  throw new PhiCryptoError(
    'decrypt',
    'bad_tag',
    new Error('Legacy packed PHI ciphertext could not be decrypted with any configured key'),
  );
}

function looksLikeBase64Token(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/=]+$/.test(value);
}

/**
 * Check if PHI encryption is configured.
 * Returns false in dev environments without a key — fields stored as plaintext.
 */
export function isPhiEncryptionEnabled(): boolean {
  if (process.env.PHI_ENCRYPTION_KEYRING_JSON?.trim()) return true;
  const key = process.env.PHI_ENCRYPTION_KEY?.trim();
  return Boolean(key && /^[a-f0-9]{64}$/i.test(key));
}

/**
 * Encrypt a PHI value. Returns "iv:tag:ciphertext" or original value if encryption not configured.
 */
export function encryptPhi(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  if (!isPhiEncryptionEnabled()) {
    // Test-only compatibility path for suites that intentionally run with
    // crypto disabled to verify FAILED sentinels in adjacent modules.
    if (process.env.NODE_ENV === 'test') return plaintext;
    const err = new Error('PHI key not configured');
    logger.error({ err, op: 'encrypt', reason: 'bad_key' }, 'PHI encrypt failure');
    throw new PhiCryptoError('encrypt', 'bad_key', err);
  }

  try {
    const { version, key } = getActiveKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${version}:${iv.toString(ENCODING)}:${tag.toString(ENCODING)}:${encrypted.toString(ENCODING)}`;
  } catch (err) {
    // BUG-441: no plaintext fallback. A failed encrypt MUST propagate so
    // the caller's request fails cleanly with a 500 rather than silently
    // storing plaintext in an ENCRYPTED column.
    const reason = /key length|invalid key/i.test(String((err as Error)?.message)) ? 'bad_key' : 'internal';
    logger.error({ err, op: 'encrypt', reason }, 'PHI encrypt failure');
    throw new PhiCryptoError('encrypt', reason, err);
  }
}

/**
 * Decrypt a PHI value. Returns plaintext or the original value if not encrypted.
 */
export function decryptPhi(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!isPhiEncryptionEnabled()) {
    if (process.env.NODE_ENV === 'test') return ciphertext;
    const err = new Error('PHI key not configured');
    logger.error({ err, op: 'decrypt', reason: 'bad_key' }, 'PHI decrypt failure');
    throw new PhiCryptoError('decrypt', 'bad_key', err);
  }

  // Legacy-compat: plaintext values written before encryption was enabled
  // pass through unchanged. Encrypted inputs are:
  //   - versioned format: keyVersion:iv:tag:ciphertext (4 parts)
  //   - legacy format:    iv:tag:ciphertext            (3 parts, assumes v1)
  //   - older packed util format (base64 iv+ciphertext+tag)
  const parts = ciphertext.split(':');
  if (parts.length !== 3 && parts.length !== 4) {
    const legacy = tryDecryptLegacyPackedBlob(ciphertext);
    return legacy ?? ciphertext;
  }
  const offset = parts.length === 4 ? 1 : 0;
  const b64Tokens = [
    parts[offset + 0]!,
    parts[offset + 1]!,
    parts[offset + 2]!,
  ];
  if (!b64Tokens.every(looksLikeBase64Token)) {
    return ciphertext;
  }
  const ivProbe = Buffer.from(parts[offset + 0]!, ENCODING);
  const tagProbe = Buffer.from(parts[offset + 1]!, ENCODING);
  // Reject non-payload strings that happen to contain colons with
  // alphanumeric tokens (e.g. "only:two:colons:four").
  if (ivProbe.length !== IV_LENGTH || tagProbe.length !== 16) {
    return ciphertext;
  }

  try {
    const version = parts.length === 4 ? parts[0]! : 'v1';
    const key = getKeyForVersion(version);
    const iv = Buffer.from(parts[offset + 0]!, ENCODING);
    const tag = Buffer.from(parts[offset + 1]!, ENCODING);
    const encrypted = Buffer.from(parts[offset + 2]!, ENCODING);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    // BUG-441: no ciphertext-passthrough fallback. The input LOOKED encrypted
    // (3-part colon format) but decryption failed — tampered auth tag, wrong
    // key, corrupted buffer. Silently returning raw bytes would surface as
    // "weird characters in a clinical field"; throwing forces the caller to
    // see a 500 + observable audit-log entry.
    const msg = String((err as Error)?.message ?? '');
    const reason: 'bad_tag' | 'bad_key' | 'bad_format' | 'internal' = /auth/i.test(msg)
      ? 'bad_tag'
      : /key length/i.test(msg)
      ? 'bad_key'
      : /invalid|malformed/i.test(msg)
      ? 'bad_format'
      : 'internal';
    logger.error({ err, op: 'decrypt', reason }, 'PHI decrypt failure');
    throw new PhiCryptoError('decrypt', reason, err);
  }
}

/**
 * Columns that require PHI encryption-at-rest in the patients table.
 * Renamed from PHI_FIELDS in BUG-267 L5 absorption to end the name
 * collision with utils/phiFields.PHI_FIELDS (which is the REDACTION
 * scope — a superset of this encryption scope). Different names for
 * different purposes: ENCRYPTED_PHI_COLUMNS = encryption-at-rest list;
 * PHI_FIELDS (phiFields.ts) = logger-redaction list.
 */
export const ENCRYPTED_PHI_COLUMNS = [
  // Healthcare identifiers (Australian Privacy Act APP 11, My Health Records Act)
  'medicare_number',
  'medicare_reference',
  'ihi_number',
  'dva_number',
  // Contact information
  'phone_mobile',
  'phone_home',
  'email_primary',
  'nok_phone',
  // Address (identifiable location data)
  'address_line1',
  'suburb',
  // NOTE:
  // BUG-PHI-PATIENT-CAPACITY widened encrypted patient columns to absorb
  // AES-GCM expansion. Do NOT add new encrypted columns unless storage
  // capacity is validated for ciphertext length (not plaintext length).
  // health_fund_number (varchar 50) and gp_phone/gp_fax (varchar 30)
  // remain intentionally plaintext because their current widths are too
  // short for encrypted payloads.
] as const;

/**
 * BUG-378 (2026-05-03) — boot-time self-test that the PHI encryption
 * round-trip works against the configured key.
 *
 * Why this matters:
 *   - A wrong-length / corrupted PHI_ENCRYPTION_KEY in production is the
 *     same harm class as BUG-441 (silent plaintext fallback) — except
 *     the failure surfaces at the FIRST encrypt call (some clinical
 *     write hours after boot), not at boot time.
 *   - Sibling pattern of CLAUDE.md §17.4 retention triple-lock: catch
 *     misconfiguration at the earliest possible point.
 *   - Throws PhiCryptoError on round-trip mismatch so `index.ts` can
 *     log structured fatal + process.exit(1) before the server accepts
 *     traffic.
 *
 * Behaviour:
 *   - If PHI encryption is disabled (no key set): returns
 *     `{ ok: true, mode: 'disabled' }`. Acceptable in dev/test where
 *     plaintext is the documented passthrough; production-environment
 *     enforcement is the caller's job (env var REQUIRED check).
 *   - If enabled: encrypts a sentinel + decrypts it. Asserts the
 *     decrypted value matches the original byte-for-byte.
 *   - On any deviation (encrypt throws, decrypt throws, or value
 *     mismatch): throws PhiCryptoError so the boot path fails loudly.
 */
export function runPhiEncryptionSelfTest(): { ok: true; mode: 'enabled' | 'disabled' } {
  if (!isPhiEncryptionEnabled()) {
    if (process.env.NODE_ENV !== 'test') {
      const err = new Error('PHI key not configured');
      logger.error({ err, kind: 'phi_encryption_self_test' }, 'PHI encryption key missing outside test mode');
      throw new PhiCryptoError('encrypt', 'bad_key', err);
    }
    logger.warn(
      { kind: 'phi_encryption_disabled' },
      'PHI encryption disabled — running in plaintext-passthrough mode (dev only)',
    );
    return { ok: true, mode: 'disabled' };
  }
  // Run TWO sentinels covering different byte-patterns:
  //   1. Unicode + colon-separator + long padding — exercises utf-8,
  //      split-injection of the iv:tag:ciphertext separator, multi-block GCM.
  //   2. Digit-heavy with spaces and parens — representative of real
  //      Australian PHI patterns (Medicare "2123 45678 9", IHI "8003 6080
  //      0000 0123", phone "+61 (3) 9123-4567"). AES-GCM is byte-stream so
  //      this is theoretical defence-in-depth (any byte-pattern proves the
  //      cipher works) — but cheap belt-and-braces per L4 cycle-2 advisory.
  const ts = Date.now();
  const sentinels = [
    `phi-encryption-self-test:${ts}:✓:` + 'A'.repeat(64),
    `+61 (3) 9123-4567 / 2123 45678 9 / 8003 6080 0000 0123 / ts=${ts}`,
  ];
  for (const sentinel of sentinels) {
    let ciphertext: string | null;
    try {
      ciphertext = encryptPhi(sentinel);
    } catch (err) {
      logger.error({ err, kind: 'phi_encryption_self_test' }, 'PHI encrypt phase failed at boot');
      throw new PhiCryptoError('encrypt', 'internal', err);
    }
    if (!ciphertext || ciphertext === sentinel) {
      throw new PhiCryptoError('encrypt', 'internal', new Error('encrypt returned plaintext or null'));
    }
    let roundtripped: string | null;
    try {
      roundtripped = decryptPhi(ciphertext);
    } catch (err) {
      logger.error({ err, kind: 'phi_encryption_self_test' }, 'PHI decrypt phase failed at boot');
      throw new PhiCryptoError('decrypt', 'internal', err);
    }
    if (roundtripped !== sentinel) {
      logger.error(
        { kind: 'phi_encryption_self_test', expected_len: sentinel.length, got_len: roundtripped?.length },
        'PHI round-trip mismatch — encryption key is broken',
      );
      throw new PhiCryptoError('decrypt', 'bad_tag', new Error('round-trip mismatch'));
    }
  }
  logger.info({ kind: 'phi_encryption_self_test', sentinels: sentinels.length }, 'PHI encryption round-trip OK');
  return { ok: true, mode: 'enabled' };
}

/**
 * Encrypt PHI fields in a patient data object before INSERT/UPDATE.
 * Generic-typed: preserves the caller's row shape so downstream code
 * doesn't need `as any` casts.
 */
export function encryptPatientPhi<T extends Record<string, unknown>>(data: T): T {
  if (!isPhiEncryptionEnabled()) return data;
  const result: Record<string, unknown> = { ...data };
  for (const field of ENCRYPTED_PHI_COLUMNS) {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = encryptPhi(result[field] as string);
    }
  }
  return result as T;
}

/**
 * Decrypt PHI fields in a patient row after SELECT.
 * Generic-typed: preserves the caller's row shape.
 */
export function decryptPatientPhi<T extends Record<string, unknown>>(row: T): T {
  if (!isPhiEncryptionEnabled()) return row;
  const result: Record<string, unknown> = { ...row };
  for (const field of ENCRYPTED_PHI_COLUMNS) {
    if (result[field] && typeof result[field] === 'string') {
      result[field] = decryptPhi(result[field] as string);
    }
  }
  return result as T;
}
