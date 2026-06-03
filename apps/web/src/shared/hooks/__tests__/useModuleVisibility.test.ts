/*
 * apps/web/src/shared/hooks/__tests__/useModuleVisibility.test.ts
 *
 * BUG-416 — pure-logic tests for the fail-CLOSED helper exported from
 * useModuleVisibility.ts. apps/web vitest runs without jsdom (React 19
 * dual-instance issue per the workspace vitest.config.ts header), so
 * we test the pure `failClosed` function directly + scan the source
 * for anti-pattern resurrection.
 *
 * The success path (querying staff/me + active-specialties + computing
 * visibleSpecialties) is NOT tested here because it requires
 * renderHook + jsdom; integration coverage of that path is BUG-451's
 * scope. The CRITICAL tests are the failClosed branch (MV-2 / MV-3 /
 * MV-5 / MV-6) — that's where the BUG-416 silent-disclosure shape
 * lives.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeVisibleSpecialties } from '@signacare/shared';
import { failClosed } from '../useModuleVisibility';

const HOOK_SOURCE_PATH = resolve(__dirname, '..', 'useModuleVisibility.ts');

describe('BUG-416 useModuleVisibility — fail-CLOSED on upstream error', () => {
  it('MV-A: failClosed returns the canonical fail-CLOSED state shape', () => {
    const r = failClosed();
    expect(r.visibleSpecialties).toBeInstanceOf(Set);
    expect(r.visibleSpecialties.size).toBe(0);
    expect(r.isError).toBe(true);
    expect(r.isLoading).toBe(false);
    expect(typeof r.isTabVisible).toBe('function');
    expect(typeof r.isNavVisible).toBe('function');
  });

  it('MV-B: failClosed HIDES specialty-gated patient tabs (ECT/TMS/MHA/legal/oncology/etc) — PRE-FIX RED', () => {
    const r = failClosed();
    // These tabs are specialty-gated in moduleRegistry.ts. With an
    // empty visibleSpecialties set, the shared helper returns false
    // for each (the canonical fail-CLOSED-for-security behaviour).
    expect(r.isTabVisible('ect')).toBe(false);
    expect(r.isTabVisible('tms')).toBe(false);
    expect(r.isTabVisible('legal')).toBe(false);
    expect(r.isTabVisible('chronic-diseases')).toBe(false);
    expect(r.isTabVisible('oncology')).toBe(false);
    expect(r.isTabVisible('surgery')).toBe(false);
    expect(r.isTabVisible('paediatrics')).toBe(false);
    expect(r.isTabVisible('obs-gyne')).toBe(false);
    expect(r.isTabVisible('glucose')).toBe(false);
  });

  it('MV-C: failClosed PRESERVES core patient tabs (summary/medications/pathology/problems/etc)', () => {
    const r = failClosed();
    // Core tabs MUST stay visible on error — never hide safety-critical
    // surfaces (medications, pathology, allergies) on a transient
    // network blip.
    expect(r.isTabVisible('summary')).toBe(true);
    expect(r.isTabVisible('medications')).toBe(true);
    expect(r.isTabVisible('pathology')).toBe(true);
    expect(r.isTabVisible('problems')).toBe(true);
    expect(r.isTabVisible('alerts-plans')).toBe(true);
    expect(r.isTabVisible('episodes')).toBe(true);
    expect(r.isTabVisible('referrals')).toBe(true);
    expect(r.isTabVisible('documents')).toBe(true);
    expect(r.isTabVisible('viva')).toBe(true);
  });

  it('MV-D: failClosed HIDES specialty-gated nav items (lai/clozapine/mha/91day) — PRE-FIX RED', () => {
    const r = failClosed();
    expect(r.isNavVisible('list/lai')).toBe(false);
    expect(r.isNavVisible('list/clozapine')).toBe(false);
    expect(r.isNavVisible('list/mha')).toBe(false);
    expect(r.isNavVisible('list/91day')).toBe(false);
  });

  it('MV-E: failClosed PRESERVES core nav items (dashboard/patients/tasks/reports)', () => {
    const r = failClosed();
    // Unlisted paths default to visible per shared-helper contract
    // (isNavItemVisible returns true when entriesForPath returns
    // empty). Core navigation must remain so users can reach safe
    // surfaces during transient errors.
    expect(r.isNavVisible('dashboard')).toBe(true);
    expect(r.isNavVisible('patients')).toBe(true);
    expect(r.isNavVisible('tasks')).toBe(true);
    expect(r.isNavVisible('reports')).toBe(true);
    expect(r.isNavVisible('appointments')).toBe(true);
  });

  it('MV-F: source-text — function failOpen REMOVED (anti-pattern resurrection trap) — PRE-FIX RED', () => {
    const source = readFileSync(HOOK_SOURCE_PATH, 'utf-8');
    expect(source).not.toMatch(/^(export )?function failOpen/m);
    expect(source).toMatch(/^export function failClosed/m);
  });

  it('MV-G: source-text — no `() => true` predicate inside an isError branch — PRE-FIX RED', () => {
    const source = readFileSync(HOOK_SOURCE_PATH, 'utf-8');
    // Pre-fix shape: `isTabVisible: () => true` and `isNavVisible: () => true`
    // both inside the failOpen function. Post-fix: zero such predicates.
    expect(source).not.toMatch(/isTabVisible:\s*\(\s*\)\s*=>\s*true/);
    expect(source).not.toMatch(/isNavVisible:\s*\(\s*\)\s*=>\s*true/);
    // Also pin the BUG-416 + BUG-444 mirror cite so a future "comment
    // cleanup" PR cannot silently strip the load-bearing rationale.
    expect(source).toMatch(/BUG-416/);
    expect(source).toMatch(/BUG-444/);
  });

  it('MV-H: legacy fallback — empty enabled+staff specialties defaults to mental_health for clinical users', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: [],
      staffSpecialties: [],
      userRole: 'clinician',
    });
    expect([...visible]).toEqual(['mental_health']);
  });

  it('MV-I: legacy fallback stays narrow — does not grant non-mental specialties by default', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['paediatrics'],
      staffSpecialties: [],
      userRole: 'clinician',
    });
    expect(visible.size).toBe(0);
  });

  it('MV-J: legacy fallback preserves mental-health nav for clinicians even when clinic has multiple enabled specialties', () => {
    const visible = computeVisibleSpecialties({
      enabledSpecialties: ['mental_health', 'paediatrics'],
      staffSpecialties: [],
      userRole: 'clinician',
    });
    expect(visible.has('mental_health')).toBe(true);
    expect(visible.has('paediatrics')).toBe(false);
  });
});
