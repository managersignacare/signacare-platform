/**
 * Category 1 — Unit tests for the Clozapine ANC (absolute neutrophil count)
 * risk classification and the next-blood-due window calculator.
 *
 * Why this matters: Clozapine carries a black-box agranulocytosis warning.
 * Misclassifying an ANC value or computing the wrong next-monitoring date
 * is a patient-safety event. These thresholds and the resulting monitoring
 * cadence are the most clinically dangerous pure functions in the codebase
 * — they MUST be unit-tested in isolation, not just exercised through
 * integration tests where a bug could be masked by other layers.
 *
 * Standard satisfied: ACHS EQuIPNational Standard 4 (Medication Safety),
 *                     RANZCP/Australian Clozapine Treatment Guideline 2018.
 *
 * Run: pnpm --filter api test tests/unit/clozapineRiskClassification.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAnc,
  computeNextBloodDue,
  ANC_RED_THRESHOLD,
  ANC_AMBER_THRESHOLD,
  NEXT_BLOOD_DUE_DAYS,
} from '../../src/features/clozapine/clozapineService';

describe('classifyAnc — ANC threshold matrix', () => {
  // RED: ANC < 1.5 → STOP clozapine, urgent haematology review
  it.each([
    ['exact zero', 0],
    ['profound neutropenia', 0.3],
    ['severe', 0.9],
    ['just below red threshold', 1.49],
    ['just below red threshold (3 dp)', 1.499],
  ])('classifies ANC=%s (%fx10⁹/L) as RED — cessation required', (_label, anc) => {
    expect(classifyAnc(anc)).toBe('red');
  });

  // AMBER: 1.5 ≤ ANC < 2.0 → weekly monitoring, alert
  it.each([
    ['lower amber boundary (inclusive)', 1.5],
    ['mid amber', 1.75],
    ['just below amber upper boundary', 1.99],
    ['just below amber upper boundary (3 dp)', 1.999],
  ])('classifies ANC=%s (%fx10⁹/L) as AMBER — weekly monitoring', (_label, anc) => {
    expect(classifyAnc(anc)).toBe('amber');
  });

  // NORMAL: ANC ≥ 2.0 → green, continue per phase cadence
  it.each([
    ['lower normal boundary (inclusive)', 2.0],
    ['mid normal', 4.5],
    ['high', 9.5],
    ['extreme leukocytosis', 25],
  ])('classifies ANC=%s (%fx10⁹/L) as NORMAL — continue', (_label, anc) => {
    expect(classifyAnc(anc)).toBe('normal');
  });

  // Sanity-check the threshold constants themselves so a future PR
  // that silently moves them is caught here.
  it('exposes threshold constants matching the AU clinical protocol', () => {
    expect(ANC_RED_THRESHOLD).toBe(1.5);
    expect(ANC_AMBER_THRESHOLD).toBe(2.0);
    expect(ANC_RED_THRESHOLD).toBeLessThan(ANC_AMBER_THRESHOLD);
  });

  // Defensive null/undefined handling — clinicians may save a draft
  // result before the lab value lands. The classifier must NOT throw
  // and must NOT silently default to 'normal' (which would falsely
  // reassure a downstream alerting layer).
  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns "unknown" for missing ANC (%s)', (_label, anc) => {
    expect(classifyAnc(anc)).toBe('unknown');
  });

  // Floating-point boundary realism: 1.5000000001 must NOT be red
  // because of binary float drift. Pure-equality bugs at exactly 1.5
  // have caused real-world EMR misclassifications elsewhere.
  it('handles floating-point edge values without misclassifying the boundary', () => {
    expect(classifyAnc(1.5)).toBe('amber');
    expect(classifyAnc(1.4999999999)).toBe('red');
    expect(classifyAnc(2.0)).toBe('normal');
    expect(classifyAnc(1.9999999999)).toBe('amber');
  });
});

describe('computeNextBloodDue — monitoring window calculator', () => {
  // Reference monitoring intervals taken from NEXT_BLOOD_DUE_DAYS:
  //   initiation: 7 days     (first 18 weeks)
  //   maintenance: 28 days   (after week 18 with stable bloods)
  //   tapering: 7 days       (during dose reduction)
  //   amber override: 7      (regardless of phase)
  //   red override: 1        (regardless of phase)

  it('exposes the canonical monitoring intervals', () => {
    expect(NEXT_BLOOD_DUE_DAYS.initiation).toBe(7);
    expect(NEXT_BLOOD_DUE_DAYS.maintenance).toBe(28);
    expect(NEXT_BLOOD_DUE_DAYS.tapering).toBe(7);
    expect(NEXT_BLOOD_DUE_DAYS.amber).toBe(7);
    expect(NEXT_BLOOD_DUE_DAYS.red).toBe(1);
  });

  describe('phase-based scheduling when ANC is normal', () => {
    it('initiation phase → 7 days from collection', () => {
      expect(computeNextBloodDue('2026-04-01', 'normal', 'initiation')).toBe('2026-04-08');
    });

    it('maintenance phase → 28 days from collection', () => {
      expect(computeNextBloodDue('2026-04-01', 'normal', 'maintenance')).toBe('2026-04-29');
    });

    it('tapering phase → 7 days from collection', () => {
      expect(computeNextBloodDue('2026-04-01', 'normal', 'tapering')).toBe('2026-04-08');
    });
  });

  describe('ANC status overrides phase cadence', () => {
    it('amber result on a maintenance patient → 7 days, NOT 28', () => {
      // This is the safety-critical case. A patient previously stable
      // on monthly bloods MUST be brought back weekly the moment ANC
      // drifts into the amber band.
      expect(computeNextBloodDue('2026-04-01', 'amber', 'maintenance')).toBe('2026-04-08');
    });

    it('red result on a maintenance patient → 1 day, NOT 28', () => {
      // Red is a same-day-or-next-morning recheck. Anything longer
      // is a deviation from protocol.
      expect(computeNextBloodDue('2026-04-01', 'red', 'maintenance')).toBe('2026-04-02');
    });

    it('amber result on a tapering patient → still 7 days', () => {
      expect(computeNextBloodDue('2026-04-01', 'amber', 'tapering')).toBe('2026-04-08');
    });

    it('red result on an initiation patient → 1 day (red overrides 7-day initiation)', () => {
      expect(computeNextBloodDue('2026-04-01', 'red', 'initiation')).toBe('2026-04-02');
    });
  });

  describe('calendar boundary correctness', () => {
    it('handles month rollover (Jan 28 + 7 = Feb 4)', () => {
      expect(computeNextBloodDue('2026-01-28', 'normal', 'initiation')).toBe('2026-02-04');
    });

    it('handles year rollover (Dec 30 + 7 = Jan 6 next year)', () => {
      expect(computeNextBloodDue('2026-12-30', 'normal', 'initiation')).toBe('2027-01-06');
    });

    it('handles February in a leap year (Feb 25 2028 + 7 = Mar 3)', () => {
      // 2028 is a leap year (Feb has 29 days)
      expect(computeNextBloodDue('2028-02-25', 'normal', 'initiation')).toBe('2028-03-03');
    });

    it('handles February in a non-leap year (Feb 25 2026 + 7 = Mar 4)', () => {
      expect(computeNextBloodDue('2026-02-25', 'normal', 'initiation')).toBe('2026-03-04');
    });

    it('handles 28-day maintenance crossing a month boundary correctly', () => {
      // 2026-03-15 + 28 days = 2026-04-12
      expect(computeNextBloodDue('2026-03-15', 'normal', 'maintenance')).toBe('2026-04-12');
    });
  });

  describe('defensive: unknown phase falls back to monthly', () => {
    it('unrecognised phase string defaults to 28 days (maintenance cadence)', () => {
      // Defensive default — the alternative would be to throw, which
      // could break a clinical save flow. 28 days matches maintenance.
      expect(computeNextBloodDue('2026-04-01', 'normal', 'gibberish-phase')).toBe('2026-04-29');
    });
  });
});
