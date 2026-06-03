// apps/api/src/mcp/scribeAllergyAssessor.ts
//
// BUG-394 — AI scribe Pass-2 drug-allergy cross-check.
//
// Pure function (no DB, no HTTP). Takes the verified medications
// extracted from the consultation transcript (Pass-1 output) and the
// patient's active drug allergies (loaded by the caller via
// `allergyRepository.findActiveDrugAllergiesForPatient`), returns
// `SafetyAlert[]` to be merged into the existing scribe safetyAlerts
// array.
//
// SSoT discipline: imports `allergensCrossReactingWith` from
// `apps/api/src/features/medications/allergyMatching.ts`. The same
// matrix that fails an order at /medications POST (via
// checkContraindications) is the matrix that warns on a scribe
// draft. One rule, two surfaces.
//
// Filters:
//   - Only `change` ∈ {started, increased, continued, decreased,
//     ceased} — 'mentioned' entries are NOT cross-checked (avoids
//     false-positives from clinician dictating "we discussed her
//     penicillin allergy").
//   - Repository upstream filters allergen_type='drug' +
//     status='active' + deleted_at IS NULL (CLAUDE.md §1.4 + §13).
//     This pure assessor does NOT re-implement those filters.
//
// Severity mapping (locked policy 2026-04-26):
//   - severe | anaphylaxis (any case)        → critical
//   - moderate | mild | unknown | null | ""  → warning  (conservative;
//     a recorded allergy of unknown severity warrants a warning, not
//     info, because patient safety > clinician convenience).
//
// What this function does NOT do (deliberate scope boundary):
//   - Does NOT block sign-off on critical alerts. UI gate is
//     BUG-394-FOLLOWUP-2 (separate clinical-safety design decision —
//     consistent with how dose-range critical alerts surface today).
//   - Does NOT extend CLASS_MATRIX to cephalosporin↔penicillin —
//     BUG-394-FOLLOWUP-1 (clinical-evidence decision; 2026 literature
//     mixed on cross-reactivity rate).
//
// fix-registry anchors: R-FIX-BUG-394-ASSESS-ALLERGIES-EXPORT,
// R-FIX-BUG-394-CRITICAL-MAP-SEVERE, R-FIX-BUG-394-CRITICAL-MAP-ANAPHYLAXIS.

import { allergensCrossReactingWith } from '../features/medications/allergyMatching';
import { logger } from '../utils/logger';
import type { VerifiedMedication, SafetyAlert } from './medicalScribe';

/**
 * Minimal patient_allergies projection consumed by the scribe Pass-2
 * cross-check. The full row carries id / clinic_id / patient_id /
 * status / created_at / etc; assessAllergies only needs the three
 * fields that drive the alert message + severity decision.
 */
export interface AllergyContextRow {
  allergen: string;
  severity: string | null;
  reaction: string | null;
}

const PRESCRIBING_INTENT_CHANGES: ReadonlySet<VerifiedMedication['change']> = new Set([
  'started',
  'increased',
  'continued',
  'decreased',
  'ceased',
]);

function mapAllergySeverityToAlert(severity: string | null): 'critical' | 'warning' {
  if (!severity) return 'warning';
  const lower = severity.toLowerCase().trim();
  if (lower === 'severe') return 'critical';
  if (lower === 'anaphylaxis') return 'critical';
  return 'warning';
}

export function assessAllergies(
  verifiedMedications: readonly VerifiedMedication[],
  allergyRows: readonly AllergyContextRow[],
): SafetyAlert[] {
  if (verifiedMedications.length === 0 || allergyRows.length === 0) return [];

  const alerts: SafetyAlert[] = [];
  const allergenStrings = allergyRows.map((r) => r.allergen);

  for (const med of verifiedMedications) {
    if (!PRESCRIBING_INTENT_CHANGES.has(med.change)) continue;

    const conflicts = allergensCrossReactingWith(med.name, allergenStrings);
    if (conflicts.length === 0) continue;

    // Pick the worst-severity matching allergy row to drive the alert
    // severity. If a patient has BOTH a severe AND a mild record for
    // the same allergen family, the severe record wins.
    let worstSeverity: 'critical' | 'warning' = 'warning';
    let driverReaction: string | null = null;
    let driverAllergen: string | null = null;
    for (const row of allergyRows) {
      const conflict = conflicts.find((c) => allergensCrossReactingWith(row.allergen, [c]).length > 0);
      if (!conflict) continue;
      const sev = mapAllergySeverityToAlert(row.severity);
      if (sev === 'critical' || (worstSeverity === 'warning' && sev === 'warning')) {
        worstSeverity = sev;
        driverReaction = row.reaction;
        driverAllergen = conflict;
      }
    }

    const conflictLabel = driverAllergen ?? conflicts[0];
    const reactionFragment = driverReaction
      ? ` — recorded reaction: ${driverReaction}`
      : '';
    alerts.push({
      type: 'allergy',
      severity: worstSeverity,
      message:
        `Prescribed "${med.name}" conflicts with recorded allergy: ${conflictLabel}${reactionFragment}.`,
    });
  }

  return alerts;
}

/**
 * Load-and-assess wrapper for ambient pipelines. Loads the patient's
 * active drug allergies via the repository (which filters
 * allergen_type='drug' + status='active' + deleted_at IS NULL per
 * CLAUDE.md §1.4 + §13), then runs `assessAllergies`.
 *
 * Failure-path behaviour: if the repository load throws (DB unreachable,
 * connection drift), the wrapper returns `[]` and emits a structured
 * ERROR log so the missing cross-check is observable but the scribe
 * pipeline continues. This mirrors the BUG-424
 * `recordWhisperAsrInteractionSafely` pattern — fail-loud-but-non-blocking
 * for forensic/observability concerns; clinical flow proceeds.
 *
 * Returns `[]` when patientId is absent (the scribe surface supports
 * patient-less drafts; allergies are by definition patient-scoped).
 */
export async function assessAllergiesForAmbientPipeline(
  clinicId: string,
  patientId: string | null | undefined,
  verifiedMedications: readonly VerifiedMedication[],
): Promise<SafetyAlert[]> {
  if (!patientId) return [];
  try {
    const { allergyRepository } = await import('../features/allergies/allergyRepository');
    const allergyRows = await allergyRepository.findActiveDrugAllergiesForPatient(
      clinicId,
      patientId,
    );
    return assessAllergies(verifiedMedications, allergyRows);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), clinicId, patientId },
      '[BUG-394] allergy cross-check load failed — scribe draft proceeds without allergy alerts',
    );
    return [];
  }
}
