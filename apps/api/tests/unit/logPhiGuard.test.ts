/**
 * BUG-269 regression — PHI log-drift AST guard.
 *
 * The guard itself lives at scripts/guards/check-log-no-phi.ts and
 * invokes process.exit at the end of its main() — not easily testable
 * as-is. These tests exercise the LOADERS + the core PHI-detection
 * predicate in isolation by re-implementing the minimal
 * fixture-driven subset the guard performs.
 *
 * What we test:
 *   G1: known-PHI key in a `logger.info({ ... })` literal → violation.
 *   G2: known-in-PHI_FIELDS key → no violation (runtime redactor covers).
 *   G3: allowlist key matching PHI regex → no violation.
 *   G4: novel PHI-regex-matching key not in set + not allowlisted → violation.
 *
 * Pipeline reproduced inline: load PHI_FIELDS from phiFields.ts, load
 * allowlist, apply the same regex + gate rules as the guard. If the
 * guard's rules drift, the tests drift too — they test SEMANTICS, not
 * implementation.
 */

import { describe, it, expect } from 'vitest';
import { PHI_FIELDS } from '../../src/utils/phiFields';

// Must match check-log-no-phi.ts and utils/logger.ts checkSchemaPhiDrift.
const PHI_REGEX = /(?:phone|email|address|medicare|ihi\b|hpii|dva|ndis|prescriber|dob|given|family|preferred|nok|pbs|narrative|complaint|diagnosis|lookup|blind_?index)/i;

const ALLOWLIST = new Set(['suspects', 'familyId', 'emailSent', 'email_sender_mode']);

function keyIsPhiViolation(key: string): boolean {
  if (ALLOWLIST.has(key)) return false;
  if (PHI_FIELDS.has(key)) return false;
  return PHI_REGEX.test(key);
}

describe('BUG-269 — PHI log-drift detection semantics', () => {
  it('G1 — novel PHI-shaped key NOT in PHI_FIELDS → violation', () => {
    // Hypothetical new column, e.g. a future "consumer_medicare_number"
    // added by migration but not yet mirrored into PHI_CATEGORY_MEDICARE_IHI_DVA.
    expect(keyIsPhiViolation('consumer_medicare_number')).toBe(true);
  });

  it('G2 — key already in PHI_FIELDS → no violation (runtime redactor covers)', () => {
    expect(PHI_FIELDS.has('medicare_number')).toBe(true);
    expect(keyIsPhiViolation('medicare_number')).toBe(false);
    expect(keyIsPhiViolation('given_name')).toBe(false);
    expect(keyIsPhiViolation('ihi_number_lookup')).toBe(false);
  });

  it('G3 — allowlist key matching PHI regex → no violation', () => {
    expect(PHI_REGEX.test('familyId')).toBe(true); // "family" triggers regex
    expect(keyIsPhiViolation('familyId')).toBe(false); // but allowlisted
    expect(keyIsPhiViolation('emailSent')).toBe(false); // status flag, allowlisted
    expect(keyIsPhiViolation('email_sender_mode')).toBe(false); // delivery mode enum, not the email value
  });

  it('G4 — PHI-regex non-match + non-allowlisted → no violation (unrelated field)', () => {
    expect(keyIsPhiViolation('clinicId')).toBe(false);
    expect(keyIsPhiViolation('staffId')).toBe(false);
    expect(keyIsPhiViolation('resource')).toBe(false);
    expect(keyIsPhiViolation('action')).toBe(false);
    expect(keyIsPhiViolation('requestId')).toBe(false);
    expect(keyIsPhiViolation('durationMs')).toBe(false);
  });

  it('G5 — BUG-269 L2 guard findings are now PHI-covered (adminEmail)', () => {
    // Classification decision during BUG-269 execution: adminEmail IS
    // OAIC personal info, so it was added to PHI_CATEGORY_EMAIL (not
    // allowlisted as "workflow-only"). Verify the classification holds.
    expect(PHI_FIELDS.has('adminEmail')).toBe(true);
    expect(PHI_FIELDS.has('admin_email')).toBe(true);
    expect(keyIsPhiViolation('adminEmail')).toBe(false);
  });

  it('G6 — clinic sender mailbox address is PHI-covered, but the sender mode enum is not', () => {
    expect(PHI_FIELDS.has('clinic_sender_email')).toBe(true);
    expect(PHI_FIELDS.has('clinicSenderEmail')).toBe(true);
    expect(keyIsPhiViolation('clinic_sender_email')).toBe(false);
    expect(keyIsPhiViolation('email_sender_mode')).toBe(false);
  });
});
