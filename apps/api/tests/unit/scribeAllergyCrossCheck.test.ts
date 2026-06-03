// apps/api/tests/unit/scribeAllergyCrossCheck.test.ts
//
// BUG-394 — TDD RED-gate for the AI scribe Pass-2 drug-allergy cross-check.
//
// Pre-fix shape: ambientProcessor's Pass-2 verifies medications + assesses
// risk + emits monitoring alerts, but does NOT cross-check the prescribed
// drug against patient_allergies. A scribe draft can output "started
// amoxicillin 500mg" for a patient with an active 'penicillin' allergy
// (severe) and surface NO warning to the clinician.
//
// Post-fix shape: a new `assessAllergies(verifiedMedications, allergyRows)`
// pure function in medicalScribe.ts. Reuses the canonical CLASS_MATRIX +
// allergensCrossReactingWith() from `apps/api/src/features/medications/
// allergyMatching.ts` (extracted as SSoT — same matrix that prescribing
// path's checkContraindications uses). Returns `SafetyAlert[]` to be merged
// into the existing safetyAlerts array.
//
// Decisions locked (per BUG-394 plan, 2026-04-26):
//   - Cross-check fires ONLY for active prescribing intent (`change` in
//     {started, increased, continued, decreased, ceased}). 'mentioned'
//     entries are NOT cross-checked — avoids false-positives from
//     "we discussed her penicillin allergy".
//   - Severity mapping: severe|anaphylaxis → critical; moderate → warning;
//     mild|null → warning (conservative). unknown → warning.
//   - Inactive allergies (status != 'active') are NOT cross-checked —
//     `findActiveDrugAllergiesForPatient` already filters status='active'.
//   - allergen_type='drug' only — already filtered upstream by the
//     repository helper.
//   - Reaction text included in the alert message when present.
//   - Drug-class hierarchy v1: existing CLASS_MATRIX (β-lactam, sulfa,
//     NSAID). Cephalosporin↔penicillin = BUG-394-FOLLOWUP-1 (clinical
//     evidence decision).
//   - No hard sign-off block for v1 — alert surfaces, UI gate is
//     BUG-394-FOLLOWUP-2.
import { describe, it, expect } from 'vitest';
import {
  assessAllergies,
  type AllergyContextRow,
} from '../../src/mcp/medicalScribe';
import type { VerifiedMedication } from '../../src/mcp/medicalScribe';

const VMED = (overrides: Partial<VerifiedMedication> = {}): VerifiedMedication => ({
  name: 'amoxicillin',
  change: 'started',
  isS8: false,
  doseInRange: null,
  ...overrides,
});

const ALLERGY = (overrides: Partial<AllergyContextRow> = {}): AllergyContextRow => ({
  allergen: 'penicillin',
  severity: 'severe',
  reaction: 'rash + anaphylaxis history',
  ...overrides,
});

describe('BUG-394 — assessAllergies (scribe Pass-2 drug-allergy cross-check)', () => {
  it('TP-AAC-1: amoxicillin started + penicillin (severe) allergy → CRITICAL alert', () => {
    const alerts = assessAllergies([VMED()], [ALLERGY()]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('allergy');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].message.toLowerCase()).toContain('amoxicillin');
    expect(alerts[0].message.toLowerCase()).toContain('penicillin');
    expect(alerts[0].message.toLowerCase()).toContain('anaphylaxis');
  });

  it('TP-AAC-2: amoxicillin started + penicillin (moderate) → WARNING (not critical)', () => {
    const alerts = assessAllergies([VMED()], [ALLERGY({ severity: 'moderate' })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('TP-AAC-3: amoxicillin started + penicillin (mild) → WARNING (conservative; no info-only)', () => {
    const alerts = assessAllergies([VMED()], [ALLERGY({ severity: 'mild' })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('TP-AAC-4: drug-name MENTIONED (not prescribed) → NO alert', () => {
    const alerts = assessAllergies([VMED({ change: 'mentioned' })], [ALLERGY()]);
    expect(alerts).toEqual([]);
  });

  it('TP-AAC-5: direct match (amoxicillin allergy + amoxicillin started) → CRITICAL', () => {
    const alerts = assessAllergies([VMED()], [ALLERGY({ allergen: 'amoxicillin', severity: 'anaphylaxis' })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].message.toLowerCase()).toContain('amoxicillin');
  });

  it('TP-AAC-6: empty allergy list → NO alert', () => {
    const alerts = assessAllergies([VMED()], []);
    expect(alerts).toEqual([]);
  });

  it('TP-AAC-7: empty medication list → NO alert', () => {
    const alerts = assessAllergies([], [ALLERGY()]);
    expect(alerts).toEqual([]);
  });

  it('TP-AAC-8: dose-suffix tolerance — "amoxicillin 500mg" started + penicillin allergy → CRITICAL', () => {
    const alerts = assessAllergies([VMED({ name: 'Amoxicillin 500mg' })], [ALLERGY()]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('TP-AAC-9: severity unknown → WARNING (conservative; not info)', () => {
    const alerts = assessAllergies([VMED()], [ALLERGY({ severity: 'unknown' })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('TP-AAC-10: ceased medication still cross-checks (clinician must know not to re-prescribe)', () => {
    const alerts = assessAllergies([VMED({ change: 'ceased' })], [ALLERGY()]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
  });

  it('TP-AAC-11: multiple meds — only the conflicting one alerts', () => {
    const alerts = assessAllergies(
      [VMED({ name: 'sertraline' }), VMED({ name: 'amoxicillin' })],
      [ALLERGY()],
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message.toLowerCase()).toContain('amoxicillin');
    expect(alerts[0].message.toLowerCase()).not.toContain('sertraline');
  });

  it('TP-AAC-12: no reaction text in allergy row → message still well-formed (no `null` literal)', () => {
    const alerts = assessAllergies([VMED()], [ALLERGY({ reaction: null })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].message).not.toContain('null');
  });
});
