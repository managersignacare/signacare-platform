/**
 * BUG-296 regression — HPI-I format + Luhn validation + prescribing gate.
 *
 * Pre-fix: staff.hpii was free-text. No 16-digit check, no Luhn,
 * no HI Service lookup. A typo or copy-paste error flowed unvalidated
 * through to NPDS + eRx Adapter, producing malformed submissions that
 * eRx rejected. No gate on the prescribing path.
 *
 * Post-fix:
 *   (1) shared/hiNumbers.ts — generic validateHiNumber(value, prefix)
 *       helper. SSoT for IHI/HPI-I/HPI-O validation.
 *   (2) hiServiceClient.ts — NEW validateHpiiFormat() + validateHpioFormat()
 *       exports delegating to the shared helper. validateIhiFormat()
 *       refactored to delegate too.
 *   (3) shared/authGuards.ts — NEW requireValidHpii(auth) guard.
 *       S0 hardening: strict-only posture (missing/malformed HPI-I
 *       always blocks; no warn-mode and no role bypass).
 *   (4) medicationService.create + prescriptionService.create/submitErx
 *       call requireValidHpii(auth) alongside requirePrescribingDiscipline.
 *
 * Coverage (11 tests):
 *   T1 — validateHiNumber accepts valid HPI-I (800361 + Luhn).
 *   T2 — validateHiNumber rejects IHI prefix (800360) when HPI-I expected.
 *   T3 — validateHiNumber rejects HPI-O prefix (800362) when HPI-I expected.
 *   T4 — validateHiNumber rejects wrong length.
 *   T5 — validateHiNumber rejects non-numeric chars.
 *   T6 — validateHiNumber rejects bad Luhn.
 *   T7 — validateHiNumber accepts IHI with correct prefix.
 *   T8 — validateHiNumber accepts HPI-O with correct prefix.
 *   T9 — strict-only: clinician with NULL hpii throws
 *         PRESCRIBER_HPII_INVALID.
 *   T10 — strict-only: clinician with valid HPI-I passes.
 *   T11 — strict-only: admin with NULL hpii also throws
 *         PRESCRIBER_HPII_INVALID (no role bypass).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import {
  validateHiNumber,
  HI_PREFIX,
  luhnCheck,
} from '../../src/shared/hiNumbers';
import {
  validateHpiiFormat,
  validateHpioFormat,
  validateIhiFormat,
} from '../../src/integrations/hiService/hiServiceClient';
import { requireValidHpii } from '../../src/shared/authGuards';

const READY = await isIntegrationReady();

describe('BUG-296 HPI-I validation (unit)', () => {
  // Helper — generate a Luhn-valid 16-digit HI number from the 15-digit
  // prefix+body by computing the correct checksum digit.
  function fixLuhn(fifteenDigits: string): string {
    // Brute-force the checksum digit 0-9.
    for (let d = 0; d < 10; d++) {
      const candidate = fifteenDigits + String(d);
      if (luhnCheck(candidate)) return candidate;
    }
    throw new Error('No valid Luhn digit — test data malformed');
  }

  it('T1 — validateHiNumber accepts valid HPI-I (800361 + Luhn)', () => {
    const hpii = fixLuhn('800361000000000'); // 15 digits — fill last with Luhn
    expect(validateHiNumber(hpii, HI_PREFIX.HPI_I)).toBe(true);
    expect(validateHpiiFormat(hpii)).toBe(true);
  });

  it('T2 — validateHiNumber rejects IHI prefix when HPI-I expected', () => {
    const ihi = fixLuhn('800360000000000');
    expect(validateHiNumber(ihi, HI_PREFIX.HPI_I)).toBe(false);
    expect(validateHpiiFormat(ihi)).toBe(false);
  });

  it('T3 — validateHiNumber rejects HPI-O prefix when HPI-I expected', () => {
    const hpio = fixLuhn('800362000000000');
    expect(validateHiNumber(hpio, HI_PREFIX.HPI_I)).toBe(false);
  });

  it('T4 — validateHiNumber rejects wrong length', () => {
    expect(validateHiNumber('800361000000000', HI_PREFIX.HPI_I)).toBe(false); // 15 digits
    expect(validateHiNumber('80036100000000000', HI_PREFIX.HPI_I)).toBe(false); // 17 digits
  });

  it('T5 — validateHiNumber rejects non-numeric chars', () => {
    expect(validateHiNumber('800361ABCD000000', HI_PREFIX.HPI_I)).toBe(false);
  });

  it('T6 — validateHiNumber rejects bad Luhn', () => {
    // 800361 + 9 zeros + known-bad checksum digit. Pick a digit that we
    // KNOW fails Luhn by picking fixLuhn result and flipping last digit.
    const good = fixLuhn('800361000000000');
    const lastDigit = parseInt(good[15], 10);
    const bad = good.slice(0, 15) + String((lastDigit + 1) % 10);
    expect(validateHiNumber(bad, HI_PREFIX.HPI_I)).toBe(false);
  });

  it('T7 — validateHiNumber accepts IHI with correct prefix', () => {
    const ihi = fixLuhn('800360000000000');
    expect(validateHiNumber(ihi, HI_PREFIX.IHI)).toBe(true);
    expect(validateIhiFormat(ihi)).toBe(true);
  });

  it('T8 — validateHiNumber accepts HPI-O with correct prefix', () => {
    const hpio = fixLuhn('800362000000000');
    expect(validateHiNumber(hpio, HI_PREFIX.HPI_O)).toBe(true);
    expect(validateHpioFormat(hpio)).toBe(true);
  });
});

describe.skipIf(!READY)('BUG-296 requireValidHpii guard (live DB)', () => {
  let clinicId: string;
  let clinicianIdNoHpii: string;
  let clinicianIdValidHpii: string;
  const seededStaffIds: string[] = [];

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;
    const { dbAdmin } = await import('../../src/db/db');

    // Helper: generate valid HPI-I via Luhn.
    let validHpii: string | null = null;
    for (let d = 0; d < 10; d++) {
      const candidate = '800361000000000' + String(d);
      if (luhnCheck(candidate)) { validHpii = candidate; break; }
    }

    clinicianIdNoHpii = randomUUID();
    await dbAdmin('staff').insert({
      id: clinicianIdNoHpii,
      clinic_id: clinicId,
      given_name: 'BUG296NoHpii',
      family_name: 'Test',
      email: `bug296-nohpii-${clinicianIdNoHpii.slice(0, 8)}@signacare.local`,
      password_hash: 'x',
      role: 'clinician',
      discipline: 'psychiatry',
    });
    seededStaffIds.push(clinicianIdNoHpii);

    clinicianIdValidHpii = randomUUID();
    await dbAdmin('staff').insert({
      id: clinicianIdValidHpii,
      clinic_id: clinicId,
      given_name: 'BUG296ValidHpii',
      family_name: 'Test',
      email: `bug296-validhpii-${clinicianIdValidHpii.slice(0, 8)}@signacare.local`,
      password_hash: 'x',
      role: 'clinician',
      discipline: 'psychiatry',
      hpii: validHpii,
    });
    seededStaffIds.push(clinicianIdValidHpii);
  });

  async function cleanup() {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('staff').whereIn('id', seededStaffIds).del().catch(() => undefined);
  }
  // Register cleanup at process exit since afterAll is tricky with skipIf
  process.on('exit', () => { void cleanup(); });

  it('T9 — strict-only: clinician with NULL hpii throws PRESCRIBER_HPII_INVALID', async () => {
    const auth = {
      staffId: clinicianIdNoHpii,
      clinicId,
      role: 'clinician',
      permissions: [],
      patientId: undefined,
      requestId: randomUUID(),
    };
    await expect(requireValidHpii(auth)).rejects.toMatchObject({
      code: 'PRESCRIBER_HPII_INVALID',
      status: 403,
    });
  });

  it('T10 — strict-only: clinician with valid HPI-I passes', async () => {
    const auth = {
      staffId: clinicianIdValidHpii,
      clinicId,
      role: 'clinician',
      permissions: [],
      patientId: undefined,
      requestId: randomUUID(),
    };
    await expect(requireValidHpii(auth)).resolves.toBeUndefined();
  });

  it('T11 — strict-only: admin with NULL hpii throws (no bypass)', async () => {
    const auth = {
      staffId: clinicianIdNoHpii,
      clinicId,
      role: 'admin',
      permissions: [],
      patientId: undefined,
      requestId: randomUUID(),
    };
    await expect(requireValidHpii(auth)).rejects.toMatchObject({
      code: 'PRESCRIBER_HPII_INVALID',
      status: 403,
    });
  });
});
