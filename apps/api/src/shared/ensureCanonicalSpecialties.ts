import {
  ALL_SPECIALTIES,
  SPECIALTY_DISPLAY,
  SPECIALTY_SNOMED,
  type SpecialtyType,
} from '@signacare/shared';
import { dbAdmin } from '../db/db';
import logger from '../utils/logger';

const SPECIALTY_SYSTEM_BY_CODE: Record<SpecialtyType, string> = {
  mental_health: 'signacare',
  general_medicine: 'http://snomed.info/sct',
  endocrinology: 'http://snomed.info/sct',
  paediatrics: 'http://snomed.info/sct',
  obstetrics_gynaecology: 'http://snomed.info/sct',
  surgery: 'http://snomed.info/sct',
  oncology: 'http://snomed.info/sct',
};

const CANONICAL_SPECIALTY_ROWS = ALL_SPECIALTIES.map((code, index) => ({
  code,
  display: SPECIALTY_DISPLAY[code],
  system: SPECIALTY_SYSTEM_BY_CODE[code],
  snomed_code: SPECIALTY_SNOMED[code],
  sort_order: (index + 1) * 10,
  is_active: true,
}));

const VERIFY_TTL_MS = 60_000;

let lastVerifiedAt = 0;
let inFlightEnsure: Promise<void> | null = null;

async function verifyAndHealCanonicalSpecialties(caller?: string): Promise<void> {
  const existing = await dbAdmin('specialties')
    .whereIn('code', ALL_SPECIALTIES)
    .select('code') as Array<{ code: string }>;

  const existingSet = new Set(existing.map((row) => String(row.code)));
  const missing = ALL_SPECIALTIES.filter((code) => !existingSet.has(code));

  if (missing.length === 0) {
    lastVerifiedAt = Date.now();
    return;
  }

  await dbAdmin('specialties')
    .insert(CANONICAL_SPECIALTY_ROWS)
    .onConflict('code')
    .merge(['display', 'system', 'snomed_code', 'sort_order', 'is_active']);

  lastVerifiedAt = Date.now();
  logger.warn(
    {
      caller: caller ?? 'unknown',
      restoredCodes: missing,
    },
    'Canonical specialties were missing and have been auto-restored',
  );
}

/**
 * Ensures the canonical 7 specialty rows exist.
 *
 * Why this exists:
 * - referrals.target_specialty_code and episodes.specialty_code are FK-bound.
 * - if canonical specialties are missing, intake referral/episode writes fail
 *   with 23503 FK violations ("Referenced record not found").
 */
export async function ensureCanonicalSpecialties(options?: {
  force?: boolean;
  caller?: string;
}): Promise<void> {
  const now = Date.now();
  if (!options?.force && now - lastVerifiedAt < VERIFY_TTL_MS) {
    return;
  }

  if (inFlightEnsure) {
    await inFlightEnsure;
    return;
  }

  inFlightEnsure = (async () => {
    try {
      await verifyAndHealCanonicalSpecialties(options?.caller);
    } catch (err) {
      logger.error(
        {
          err,
          caller: options?.caller ?? 'unknown',
        },
        'Failed to ensure canonical specialties',
      );
      throw err;
    }
  })();

  try {
    await inFlightEnsure;
  } finally {
    inFlightEnsure = null;
  }
}
