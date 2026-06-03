/**
 * Multi-specialty Phase 2 — Module Registry visibility function.
 *
 * The `computeVisibleSpecialties` function is the single source of truth
 * for which modules a user can see in a given context. It is intentionally
 * pure and framework-agnostic so the frontend ModuleContext and any
 * future server-side gate (e.g. a feature-flag-style endpoint) can apply
 * the same rules.
 *
 * Edge cases covered:
 *
 *   - Non-patient pages (patientActiveSpecialties undefined) fall back
 *     to the clinic ∩ staff intersection.
 *   - Patients with zero active episodes also fall back to the clinic ∩
 *     staff intersection, so a freshly registered patient doesn't
 *     collapse every specialty module to zero.
 *   - A staff member enrolled in a specialty the clinic has NOT enabled
 *     never sees it (clinic wins).
 *   - A specialty disabled for the clinic never appears regardless of
 *     staff or patient state.
 *   - Invalid specialty codes (e.g. legacy data drift) are silently
 *     dropped instead of throwing — a renamed specialty can't brick
 *     every clinician's UI.
 */

import { describe, it, expect } from 'vitest';
import {
  computeVisibleSpecialties,
  isPatientTabVisible,
  isNavItemVisible,
  SpecialtyTypeEnum,
} from '@signacare/shared';

type SpecialtyType = ReturnType<typeof SpecialtyTypeEnum.parse>;

describe('computeVisibleSpecialties', () => {
  it('returns the plain intersection of clinic and staff on non-patient pages', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'endocrinology'],
      staffSpecialties: ['mental_health'],
    });
    expect([...visible].sort()).toEqual(['mental_health']);
  });

  it('drops specialties the clinic has not enabled even if the staff member is enrolled', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health'],
      staffSpecialties: ['mental_health', 'oncology'],
    });
    expect([...visible].sort()).toEqual(['mental_health']);
  });

  it('drops specialties the staff member is not enrolled in even if the clinic enables them', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'surgery'],
      staffSpecialties: ['mental_health'],
    });
    expect([...visible].sort()).toEqual(['mental_health']);
  });

  it('further narrows by patient active specialties on patient pages', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'endocrinology', 'oncology'],
      staffSpecialties: ['mental_health', 'endocrinology', 'oncology'],
      patientActiveSpecialties: ['endocrinology'],
    });
    expect([...visible].sort()).toEqual(['endocrinology']);
  });

  it('returns empty when the patient has episodes in a specialty the user cannot access', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'oncology'],
      staffSpecialties: ['mental_health'],
      patientActiveSpecialties: ['oncology'],
    });
    expect(visible.size).toBe(0);
  });

  it('falls back to the non-patient intersection when the patient has no active episodes', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'endocrinology'],
      staffSpecialties: ['mental_health', 'endocrinology'],
      patientActiveSpecialties: [],
    });
    // A freshly registered patient with no episodes should not collapse
    // every specialty tab to zero — fall back to clinic ∩ staff.
    expect([...visible].sort()).toEqual(['endocrinology', 'mental_health']);
  });

  it('silently drops invalid specialty codes from any of the three inputs', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'legacy_specialty_that_no_longer_exists'],
      staffSpecialties: ['mental_health', 'another_bogus_one'],
      patientActiveSpecialties: ['mental_health', 'typo'],
    });
    expect([...visible].sort()).toEqual(['mental_health']);
  });
});

describe('isPatientTabVisible', () => {
  const MH_ONLY: Set<SpecialtyType> = new Set(['mental_health']);
  const ENDO_ONLY: Set<SpecialtyType> = new Set(['endocrinology']);

  it('shows core tabs regardless of specialty context', () => {
    // `medications`, `summary`, `documents`, `problems` are declared core
    // in the registry — they must NEVER be hidden.
    expect(isPatientTabVisible('medications', new Set())).toBe(true);
    expect(isPatientTabVisible('summary', new Set())).toBe(true);
    expect(isPatientTabVisible('documents', new Set())).toBe(true);
    expect(isPatientTabVisible('problems', new Set())).toBe(true);
  });

  it('shows mental-health tabs when mental_health is in the visible set', () => {
    expect(isPatientTabVisible('legal', MH_ONLY)).toBe(true);
    expect(isPatientTabVisible('91day-review', MH_ONLY)).toBe(true);
    expect(isPatientTabVisible('ect', MH_ONLY)).toBe(true);
    expect(isPatientTabVisible('viva', MH_ONLY)).toBe(true);
  });

  it('hides mental-health-only tabs for a clinician who is NOT enrolled in mental_health', () => {
    expect(isPatientTabVisible('legal', ENDO_ONLY)).toBe(false);
    expect(isPatientTabVisible('91day-review', ENDO_ONLY)).toBe(false);
    expect(isPatientTabVisible('ect', ENDO_ONLY)).toBe(false);
    expect(isPatientTabVisible('pathways', ENDO_ONLY)).toBe(false);
  });

  it('treats unlisted tabs as always visible so the framework is additive', () => {
    // A tab id the registry has never heard of — must still render.
    expect(isPatientTabVisible('some-new-unlisted-tab-id', new Set())).toBe(true);
  });
});

describe('isNavItemVisible', () => {
  const MH_ONLY: Set<SpecialtyType> = new Set(['mental_health']);
  const ENDO_ONLY: Set<SpecialtyType> = new Set(['endocrinology']);

  it('shows core nav items (referrals, queue, dashboard, patients) regardless of specialty', () => {
    expect(isNavItemVisible('dashboard', new Set())).toBe(true);
    expect(isNavItemVisible('patients', new Set())).toBe(true);
    expect(isNavItemVisible('referrals', new Set())).toBe(true);
    expect(isNavItemVisible('referrals/queue', new Set())).toBe(true);
  });

  it('hides MH-only nav (LAI / Clozapine / MH Act / 91-Day) for a non-MH clinician', () => {
    expect(isNavItemVisible('list/lai', ENDO_ONLY)).toBe(false);
    expect(isNavItemVisible('list/clozapine', ENDO_ONLY)).toBe(false);
    expect(isNavItemVisible('list/mha', ENDO_ONLY)).toBe(false);
    expect(isNavItemVisible('list/91day', ENDO_ONLY)).toBe(false);
  });

  it('shows MH nav items for a MH clinician', () => {
    expect(isNavItemVisible('list/lai', MH_ONLY)).toBe(true);
    expect(isNavItemVisible('list/clozapine', MH_ONLY)).toBe(true);
    expect(isNavItemVisible('list/mha', MH_ONLY)).toBe(true);
  });

  it('treats unlisted nav paths as always visible', () => {
    expect(isNavItemVisible('some/new/route', new Set())).toBe(true);
  });
});
