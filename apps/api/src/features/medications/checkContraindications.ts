/**
 * Prescribing-safety contraindication checker.
 *
 * Called by medicationService.create() BEFORE the repository INSERT
 * so a clinically unsafe order never becomes a persisted prescription.
 * Covers three classes of failure surfaced by the hazard register:
 *
 *   1. ALLERGY_CROSS_REACTIVITY — the ordered drug (or a drug in the
 *      same class) appears on the patient's active allergy list.
 *      Penicillin + amoxicillin is the canonical example; the same
 *      β-lactam ring is the shared epitope. ACHS EQuIPNational
 *      Standard 4 requires this check at order time.
 *
 *   2. CLOZAPINE_BASELINE_ANC — clozapine may only be commenced when
 *      there is an existing `clozapine_blood_results` row for the
 *      patient with an ANC value recorded (the RANZCP protocol
 *      baseline). The helper looks for ANY blood result with a
 *      non-null `anc_value` — not just the "red" classification —
 *      because we only want to prove the baseline exists, not
 *      whether it's in range. HAZARD-002 companion control.
 *
 *   3. (Reserved) POLYPHARMACY — two antipsychotics in the same
 *      drug class. The matrix for this check is the subject of
 *      FEAT-10 in the backlog and NOT implemented here. The
 *      prescribingSafety test documents it as a structural gap
 *      that will flip when the matrix lands.
 *
 * The helper is **non-blocking for override**: a clinician with
 * explicit override authority can still prescribe after an audit
 * row is written. That gate lives in the caller (medicationService)
 * which writes `CONTRAINDICATION_OVERRIDE_REQUIRED` to audit_log.
 * This helper just returns the structured finding.
 *
 * Standard satisfied: ACHS EQuIPNational Standard 4 (Medication
 *                     Safety), RANZCP psychopharmacology guideline,
 *                     Australian Pharmaceutical Advisory Council
 *                     Medication Safety Guidelines, HAZARD-001 +
 *                     HAZARD-002 companion controls.
 */

import { db } from '../../db/db';
// BUG-394 — extracted CLASS_MATRIX + allergensCrossReactingWith into a
// shared SSoT so the prescribing-path (this file) and the AI scribe
// Pass-2 path (medicalScribe.assessAllergies) use the SAME rule. A
// regression in either surface is impossible — there is one matrix.
import { allergensCrossReactingWith } from './allergyMatching';

export type ContraindicationKind =
  | 'ALLERGY'
  | 'CLOZAPINE_BASELINE'
  | 'DRUG_CLASS_DUPLICATE';

export interface ContraindicationFinding {
  kind: ContraindicationKind;
  /** Machine-readable HTTP error code — what the route returns. */
  code: string;
  /** Clinician-facing explanation for the order-entry UI. */
  message: string;
  /** Structured detail for audit + client reconciliation. */
  details: Record<string, unknown>;
}

// BUG-394 — CLASS_MATRIX + normaliseAllergen + allergensCrossReactingWith
// extracted to `./allergyMatching.ts`. This file now imports the canonical
// matcher; the scribe path (medicalScribe.assessAllergies) imports the
// same. SSoT discipline: one matrix, two consumers.

export interface CheckContraindicationArgs {
  clinicId: string;
  patientId: string;
  drugName: string;
}

/**
 * Run all contraindication checks. Returns `null` when the order is
 * safe; returns a structured finding when it's not.
 *
 * Only performs READ queries. No writes, no audit — the caller
 * decides how to log the finding.
 */
export async function checkContraindications(
  args: CheckContraindicationArgs,
): Promise<ContraindicationFinding | null> {
  const { clinicId, patientId, drugName } = args;
  if (!drugName || !patientId || !clinicId) return null;

  // ── Check 1: allergy cross-reactivity ───────────────────────────
  const allergyRows = await db('patient_allergies')
    .where({ clinic_id: clinicId, patient_id: patientId, status: 'active' })
    .whereNull('deleted_at')
    .select('allergen', 'severity');
  const activeAllergens = allergyRows.map((r: { allergen: string }) => r.allergen);
  const conflicts = allergensCrossReactingWith(drugName, activeAllergens);
  if (conflicts.length > 0) {
    return {
      kind: 'ALLERGY',
      code: 'ALLERGY_CONTRAINDICATION',
      message: `Ordered drug "${drugName}" conflicts with recorded allergy: ${conflicts.join(', ')}.`,
      details: {
        drugName,
        conflictingAllergens: conflicts,
      },
    };
  }

  // ── Check 2: clozapine baseline ANC ─────────────────────────────
  if (/clozapine/i.test(drugName)) {
    const baseline = await db('clozapine_blood_results')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNotNull('anc_value')
      .first();
    if (!baseline) {
      return {
        kind: 'CLOZAPINE_BASELINE',
        code: 'CLOZAPINE_BASELINE_ANC_REQUIRED',
        message:
          'Clozapine may not be commenced without a baseline ANC result. ' +
          'Record a clozapine_blood_results row with an anc_value before prescribing.',
        details: { drugName },
      };
    }
  }

  return null;
}
