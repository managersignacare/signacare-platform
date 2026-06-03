/**
 * scripts/guards/lib/l4ClinicalFeatures.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — L5 cycle-1 absorb Drift A
 * (2026-05-06): single source of truth for the L4-required clinical-data
 * feature inventory.
 *
 * The L4 (clinical-safety-reviewer) heuristic in
 * `scripts/guards/check-review-attestation.ts` AND the spec text in
 * `docs/quality/review-attestation-format.md` were both reproducing the
 * same feature list. L5 cycle-1 verified the lists had ALREADY drifted
 * (guard had 23 entries; doc had 20). This module is the single source —
 * the guard imports from here; the doc has a mechanical parity test
 * that asserts the doc's list matches this constant exactly.
 *
 * Adding a NEW clinical-data feature directory:
 *   1. Add to L4_CLINICAL_FEATURES below.
 *   2. Update the agent rubric at .claude/agents/clinical-safety-reviewer.md
 *      so the L4 invocation also recognises the new path.
 *   3. The format doc's parity test will fail until the doc is updated to
 *      list the new feature.
 *
 * The list mirrors the canonical clinical-data feature inventory used by
 * the L4 agent + the §7.3.1 prescribing-table family. Per the L4 subject-
 * matter rubric in `feedback_l4_subject_matter_test.md`: a feature is
 * L4-required if it stores or reads diagnoses / treatment decisions /
 * medication dosing / performance scores / clinical attributions /
 * statutory triggers / consent records / AHPRA discipline-eligibility
 * evidence.
 */

/**
 * Closed list of feature directory names under `apps/api/src/features/`
 * that fire the L4 heuristic (REQUIRED L4 verdict on touched commits).
 * Sorted alphabetically for stable diff hygiene.
 */
export const L4_CLINICAL_FEATURES: readonly string[] = [
  'advance-care-planning',
  'advance-directives',
  'allergies',
  'clinical-notes',
  'clinical-review',
  'clozapine',
  'ect',
  'endocrinology',
  'episode',
  'internal-medicine',
  'lai',
  'legal',
  'llm',
  'medications',
  'obs-gyne',
  'oncology',
  'paediatrics',
  'patient-outreach',
  'patient-providers',
  'referrals',
  'risk',
  'scribe',
  'surgery',
  'tms',
] as const;

/**
 * Compiled regex form of L4_CLINICAL_FEATURES for use in path-prefix tests
 * against staged-files lists. Anchored to the start of the path; matches
 * any nested file under the feature directory.
 *
 * Built mechanically from L4_CLINICAL_FEATURES above so the two cannot
 * drift. Consumers that need the regex form import this; consumers that
 * need the list form (e.g., format doc parity test) import L4_CLINICAL_FEATURES.
 */
export const L4_HEURISTIC_FEATURE_RE: RegExp = new RegExp(
  `^apps/api/src/features/(?:${L4_CLINICAL_FEATURES.join('|')})/`,
);
