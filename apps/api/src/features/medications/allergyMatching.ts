// apps/api/src/features/medications/allergyMatching.ts
//
// BUG-394 — single source of truth for drug-allergy cross-reactivity matching.
//
// Two clinical-safety surfaces share this logic:
//   1. Prescribing path (`checkContraindications.ts`) — fails an order at
//      /medications POST when the ordered drug or its class allergen
//      appears on the patient's active allergy list.
//   2. AI scribe Pass-2 (`medicalScribe.ts assessAllergies`) — surfaces a
//      `SafetyAlert` (severity: critical|warning) on every scribe draft
//      that contains a prescribing-intent medication conflicting with a
//      recorded allergy.
//
// Pre-BUG-394, the matrix + matcher lived only in checkContraindications.ts.
// The scribe path had NO equivalent — so a clinician could see an AI-drafted
// note that prescribes amoxicillin to a penicillin-allergic patient with no
// warning surfaced. Coronial review of "wrong drug given despite recorded
// allergy" had no audit trail beyond the absent alert.
//
// SSoT discipline: every cross-reactivity rule is defined HERE, exactly once.
// Both consumers import from this file. A future contributor adding a new
// drug-class (e.g. cephalosporin↔penicillin per BUG-394-FOLLOWUP-1) edits
// CLASS_MATRIX in one place and the rule applies uniformly to prescribing
// AND scribe surfaces.
//
// Standard satisfied: ACHS EQuIPNational Standard 4 (Medication Safety),
// RANZCP psychopharmacology guideline, Australian Medicines Handbook
// cross-reactivity classes (β-lactam, sulfa, NSAID).
//
// fix-registry anchors: R-FIX-BUG-394-CLASS-MATRIX-SSOT,
// R-FIX-BUG-394-NORMALISE-EXPORT, R-FIX-BUG-394-CROSS-REACT-EXPORT.

/**
 * Drug-class cross-reactivity matrix.
 *
 * Shape: { classAllergen → [member drugs] }. Any attempt to prescribe a
 * member drug when the patient is allergic to the class allergen (or
 * vice versa) triggers a cross-reactivity finding.
 *
 * Intentionally narrow and high-confidence. False positives at order
 * entry undermine clinician trust in the guard, so every entry here is
 * a textbook cross-reactivity class from the Australian Medicines
 * Handbook:
 *   - β-lactams (penicillin family)
 *   - Sulfonamides (sulfa family)
 *   - NSAIDs (aspirin + ibuprofen sensitivity)
 *
 * Additional entries must cite a reference and land with a
 * corresponding unit test in BOTH allergyMatching.test.ts (matrix
 * shape) AND scribeAllergyCrossCheck.test.ts (scribe Pass-2 wiring).
 *
 * NOT in matrix (BUG-394-FOLLOWUP-1): cephalosporin↔penicillin —
 * 2026 literature mixed (5–10% cross-reactivity, contested). Decision
 * pending clinical-safety review.
 */
export const CLASS_MATRIX: Record<string, readonly string[]> = {
  penicillin: [
    'amoxicillin',
    'ampicillin',
    'flucloxacillin',
    'benzylpenicillin',
    'dicloxacillin',
    'piperacillin',
    'ticarcillin',
    'methicillin',
  ],
  sulfonamide: [
    'sulfamethoxazole',
    'sulfasalazine',
    'sulfadiazine',
    'sulfadoxine',
    'sulfapyridine',
    'trimethoprim-sulfamethoxazole',
    'co-trimoxazole',
    'bactrim',
  ],
  aspirin: [
    'ibuprofen',
    'naproxen',
    'diclofenac',
    'celecoxib',
    'meloxicam',
    'indomethacin',
  ],
};

/**
 * Normalise a drug or allergen string for matching. Strips trailing
 * dose suffixes and lowercases. Intentionally permissive on punctuation.
 *
 * Example: `Amoxicillin 500mg BD` → `amoxicillin` (so the matrix lookup
 * works regardless of whether the input came from a structured order
 * form or from free-text scribe extraction).
 */
export function normaliseAllergen(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s*\d[\d.]*\s*(mg|mcg|g|ml|iu|units|tablet[s]?|cap[s]?|puff[s]?)\b.*$/, '')
    .trim();
}

/**
 * Return every allergen token that the candidate drug cross-reacts with,
 * given the patient's recorded active allergens.
 *
 * Matches three ways:
 *   1. Direct: drug name == an allergen name.
 *   2. Class-member: drug is a member of a class the patient is allergic to.
 *   3. Reverse class-member: patient is allergic to a specific drug, AND
 *      the candidate is the class parent (e.g. allergic to amoxicillin,
 *      ordering penicillin).
 *
 * Returns the unique set of conflicting allergen tokens (lowercased,
 * normalised) so the caller can surface them in the alert message.
 * Returns `[]` when the drug is safe to prescribe given the allergy list.
 */
export function allergensCrossReactingWith(drug: string, activeAllergens: readonly string[]): string[] {
  const drugNorm = normaliseAllergen(drug);
  const matches: string[] = [];
  const normActive = activeAllergens.map(normaliseAllergen);

  // 1. Direct match
  if (normActive.includes(drugNorm)) {
    matches.push(drugNorm);
  }

  // 2. Class match: ordered drug is a member of a class the patient is
  // allergic to.
  for (const [classAllergen, members] of Object.entries(CLASS_MATRIX)) {
    if (normActive.includes(classAllergen) && members.includes(drugNorm)) {
      matches.push(classAllergen);
    }
  }

  // 3. Reverse class match: the candidate is the class parent of one of
  // the patient's specific-member allergies.
  for (const [classAllergen, members] of Object.entries(CLASS_MATRIX)) {
    if (drugNorm === classAllergen) {
      for (const m of members) {
        if (normActive.includes(m)) matches.push(m);
      }
    }
  }

  return Array.from(new Set(matches));
}
