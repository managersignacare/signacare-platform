/**
 * Resolves the specialty a prescriber is acting in when they create or
 * update a medication order. Used by the medication service (and any
 * future clinical write path) to stamp `prescribed_by_specialty_code`
 * on `patient_medications` without the clinician having to pick it
 * from a dropdown.
 *
 * Priority chain (first hit wins):
 *
 *   1. Explicit `explicitCode` supplied by the caller. A clinician
 *      consulting across specialties (e.g. a psychiatrist in a liaison
 *      role writing a PRN on a surgical ward) can override.
 *
 *   2. The linked episode's `specialty_code`. Prescribing is almost
 *      always in the context of an open episode, and the episode's
 *      specialty is the most reliable signal.
 *
 *   3. The staff member's primary enrollment in `staff_specialties`
 *      (the row with `is_primary = true`). Falls back to any
 *      enrollment if none is marked primary.
 *
 *   4. `mental_health` — safe default for the current MH-only product.
 *      Every existing staff member is seeded into mental_health by
 *      Phase 0, so this branch only fires if the seed was skipped.
 *
 * Every query is tenant-scoped with `clinic_id` per CLAUDE.md §1.3.
 */
import { db } from '../../db/db';

const DEFAULT_FALLBACK = 'mental_health';

export interface ResolvePrescriberSpecialtyInput {
  clinicId: string;
  actorStaffId: string;
  /** Optional FK to `episodes.id` — if set, its specialty wins over staff's primary. */
  episodeId?: string | null;
  /** Optional explicit override from the caller (e.g. cross-specialty liaison). */
  explicitCode?: string | null;
}

export async function resolvePrescriberSpecialty(
  input: ResolvePrescriberSpecialtyInput,
): Promise<string> {
  const { clinicId, actorStaffId, episodeId, explicitCode } = input;

  // 1. Explicit override.
  if (explicitCode) {
    const exists = await db('specialties').where({ code: explicitCode }).first();
    if (exists) return explicitCode;
  }

  // 2. Episode's specialty.
  if (episodeId) {
    const episode = await db('episodes')
      .where({ id: episodeId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .select('specialty_code')
      .first();
    if (episode?.specialty_code) return episode.specialty_code;
  }

  // 3. Staff's primary enrollment, then any enrollment.
  const primary = await db('staff_specialties')
    .where({ staff_id: actorStaffId, clinic_id: clinicId, is_primary: true })
    .whereNull('deleted_at')
    .select('specialty_code')
    .first();
  if (primary?.specialty_code) return primary.specialty_code;

  const any = await db('staff_specialties')
    .where({ staff_id: actorStaffId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .orderBy('created_at', 'asc')
    .select('specialty_code')
    .first();
  if (any?.specialty_code) return any.specialty_code;

  // 4. Safe fallback.
  return DEFAULT_FALLBACK;
}

/**
 * Best-effort category derivation from legacy MH flags. Exposed so that
 * callers that still use `isLai` / `isClozapine` fields get a consistent
 * `category` stamped without having to pass it explicitly.
 */
export function deriveCategoryFromLegacyFlags(flags: {
  isLai?: boolean | null;
  isClozapine?: boolean | null;
}): string | null {
  if (flags.isClozapine) return 'clozapine';
  if (flags.isLai) return 'antipsychotic_lai';
  return null;
}
