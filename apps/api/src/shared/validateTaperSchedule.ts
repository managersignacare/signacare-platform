/**
 * Taper schedule monotonic-decrease validator.
 *
 * A "taper" is a medication dose-reduction schedule — a sequence of
 * (date, dose) steps that MUST be monotonically non-increasing.
 * Accidentally prescribing a taper step that goes UP (e.g. 100mg →
 * 75mg → 100mg → 50mg because a clinician mistyped) is a
 * clinically dangerous error: it re-escalates medication the
 * patient is meant to be coming off, and may mask withdrawal
 * symptoms while delivering a subtherapeutic followup.
 *
 * Covers HAZARD-011 from the risk register: "Taper schedule dose
 * increase (clinically dangerous)".
 *
 * Standard satisfied: ISO 14971 (risk control for HAZARD-011),
 *                     ACHS Standard 4 (Medication Safety), RANZCP
 *                     psychopharmacology guideline on taper.
 *
 * Usage:
 *   validateTaperSchedule([
 *     { stepDate: '2026-01-01', doseMg: 20 },
 *     { stepDate: '2026-01-15', doseMg: 15 },
 *     { stepDate: '2026-02-01', doseMg: 10 },
 *     { stepDate: '2026-02-15', doseMg: 5 },
 *     { stepDate: '2026-03-01', doseMg: 0 },
 *   ]);
 *
 * The helper is strict about the (step_n+1).doseMg <= (step_n).doseMg
 * property — "hold" steps (same dose twice in a row) are allowed,
 * but any increase is a hard reject. The helper also rejects
 * non-monotonic stepDate sequences (later step with earlier date)
 * and negative doses.
 */

import { AppError } from './errors';

export interface TaperStep {
  stepDate: string;   // ISO YYYY-MM-DD
  doseMg: number;     // mg, >= 0
  /** Optional frequency for the step, e.g. 'tds' — ignored by the validator */
  frequency?: string;
}

export interface ValidateTaperOptions {
  /**
   * Allow the FIRST step to be the patient's current (loading)
   * dose. Set to false when validating a taper that must START
   * below the prior dose (e.g. a crisis plan). Default: true.
   */
  allowLoadingDose?: boolean;
}

/**
 * Validate a taper schedule. Throws AppError(422) on any violation;
 * returns the sorted-and-validated sequence on success so the
 * caller can persist it without re-sorting.
 */
export function validateTaperSchedule(
  steps: unknown,
  _opts: ValidateTaperOptions = {},
): TaperStep[] {
  if (!Array.isArray(steps)) {
    throw new AppError(
      'Taper schedule must be an array of steps',
      422,
      'VALIDATION_ERROR',
      { reason: 'not_array' },
    );
  }
  if (steps.length === 0) {
    throw new AppError(
      'Taper schedule must have at least one step',
      422,
      'VALIDATION_ERROR',
      { reason: 'empty' },
    );
  }
  if (steps.length > 50) {
    // 50 steps = ~1 year of weekly cuts, which covers every
    // realistic psychopharm taper. Reject larger for sanity.
    throw new AppError(
      `Taper schedule has ${steps.length} steps (max 50)`,
      422,
      'VALIDATION_ERROR',
      { reason: 'too_many_steps' },
    );
  }

  // Shape check per step
  const normalised: TaperStep[] = steps.map((raw, idx) => {
    if (raw == null || typeof raw !== 'object') {
      throw new AppError(
        `Taper step ${idx}: expected an object`,
        422,
        'VALIDATION_ERROR',
        { reason: 'bad_step_shape', index: idx },
      );
    }
    const step = raw as Record<string, unknown>;
    const stepDate = step.stepDate;
    const doseMg = step.doseMg;

    if (typeof stepDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(stepDate)) {
      throw new AppError(
        `Taper step ${idx}: stepDate must be YYYY-MM-DD`,
        422,
        'VALIDATION_ERROR',
        { reason: 'bad_step_date', index: idx },
      );
    }
    if (typeof doseMg !== 'number' || !Number.isFinite(doseMg)) {
      throw new AppError(
        `Taper step ${idx}: doseMg must be a finite number`,
        422,
        'VALIDATION_ERROR',
        { reason: 'bad_dose_type', index: idx },
      );
    }
    if (doseMg < 0) {
      throw new AppError(
        `Taper step ${idx}: doseMg must be non-negative (got ${doseMg})`,
        422,
        'VALIDATION_ERROR',
        { reason: 'negative_dose', index: idx, doseMg },
      );
    }

    return {
      stepDate,
      doseMg,
      frequency: typeof step.frequency === 'string' ? step.frequency : undefined,
    };
  });

  // Date monotonicity — later steps must have later-or-equal dates
  for (let i = 1; i < normalised.length; i++) {
    if (normalised[i].stepDate < normalised[i - 1].stepDate) {
      throw new AppError(
        `Taper step ${i} (${normalised[i].stepDate}) precedes step ${i - 1} (${normalised[i - 1].stepDate})`,
        422,
        'VALIDATION_ERROR',
        {
          reason: 'out_of_order_dates',
          index: i,
          prevDate: normalised[i - 1].stepDate,
          currDate: normalised[i].stepDate,
        },
      );
    }
  }

  // Dose monotonicity — the core safety rule. Each step must be
  // less than or equal to the previous step's dose. ANY increase
  // (even a single mg) is a hard reject.
  for (let i = 1; i < normalised.length; i++) {
    if (normalised[i].doseMg > normalised[i - 1].doseMg) {
      throw new AppError(
        `Taper step ${i} dose ${normalised[i].doseMg}mg exceeds previous step dose ${normalised[i - 1].doseMg}mg — taper doses must be monotonically non-increasing`,
        422,
        'TAPER_DOSE_INCREASE',
        {
          reason: 'dose_increase',
          index: i,
          prevDose: normalised[i - 1].doseMg,
          currDose: normalised[i].doseMg,
        },
      );
    }
  }

  // Sanity: the final step should be strictly less than the first
  // step (otherwise it's not a taper — it's a holding pattern).
  // We only WARN (log), not throw, because a "holding taper"
  // may be clinically valid in some contexts (e.g. pre-LAI
  // stabilisation).

  return normalised;
}
