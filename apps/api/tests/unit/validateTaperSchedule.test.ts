/**
 * Unit tests for validateTaperSchedule.
 *
 * Standard satisfied: ISO 14971 HAZARD-011 control, ACHS Standard 4.
 */

import { describe, it, expect } from 'vitest';
import { validateTaperSchedule } from '../../src/shared/validateTaperSchedule';

describe('validateTaperSchedule', () => {
  describe('Happy path — monotonically decreasing', () => {
    it('accepts a standard 5-step taper', () => {
      const result = validateTaperSchedule([
        { stepDate: '2026-01-01', doseMg: 20 },
        { stepDate: '2026-01-15', doseMg: 15 },
        { stepDate: '2026-02-01', doseMg: 10 },
        { stepDate: '2026-02-15', doseMg: 5 },
        { stepDate: '2026-03-01', doseMg: 0 },
      ]);
      expect(result).toHaveLength(5);
      expect(result[0].doseMg).toBe(20);
      expect(result[4].doseMg).toBe(0);
    });

    it('accepts a hold step (same dose twice)', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 40 },
          { stepDate: '2026-01-15', doseMg: 30 },
          { stepDate: '2026-02-01', doseMg: 30 }, // hold
          { stepDate: '2026-02-15', doseMg: 20 },
        ]),
      ).not.toThrow();
    });

    it('accepts a single-step "taper" (edge case — immediate cessation)', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 0 },
        ]),
      ).not.toThrow();
    });

    it('accepts steps with fractional doses (e.g. 2.5mg)', () => {
      const result = validateTaperSchedule([
        { stepDate: '2026-01-01', doseMg: 10 },
        { stepDate: '2026-01-15', doseMg: 7.5 },
        { stepDate: '2026-02-01', doseMg: 5 },
        { stepDate: '2026-02-15', doseMg: 2.5 },
      ]);
      expect(result[3].doseMg).toBe(2.5);
    });

    it('preserves optional frequency field', () => {
      const result = validateTaperSchedule([
        { stepDate: '2026-01-01', doseMg: 30, frequency: 'tds' },
        { stepDate: '2026-01-15', doseMg: 20, frequency: 'bd' },
        { stepDate: '2026-02-01', doseMg: 10, frequency: 'daily' },
      ]);
      expect(result[0].frequency).toBe('tds');
      expect(result[1].frequency).toBe('bd');
      expect(result[2].frequency).toBe('daily');
    });
  });

  describe('HAZARD-011: dose-increase rejection', () => {
    it('rejects a schedule with a single upward step', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 20 },
          { stepDate: '2026-01-15', doseMg: 30 }, // INCREASE
        ]),
      ).toThrow(/monotonically non-increasing|dose_increase/i);
    });

    it('rejects mid-schedule upward step (100→75→100→50)', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 100 },
          { stepDate: '2026-01-15', doseMg: 75 },
          { stepDate: '2026-02-01', doseMg: 100 }, // INCREASE
          { stepDate: '2026-02-15', doseMg: 50 },
        ]),
      ).toThrow(/100mg/);
    });

    it('rejects even a 1mg upward drift (strict)', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 20 },
          { stepDate: '2026-01-15', doseMg: 20.5 },
        ]),
      ).toThrow();
    });

    it('error code is TAPER_DOSE_INCREASE (structured)', () => {
      try {
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 20 },
          { stepDate: '2026-01-15', doseMg: 30 },
        ]);
        expect.fail('expected throw');
      } catch (err: unknown) {
        const appErr = err as {
          code?: string;
          status?: number;
          details?: {
            reason?: string;
            index?: number;
            prevDose?: number;
            currDose?: number;
          };
        };
        expect(appErr.code).toBe('TAPER_DOSE_INCREASE');
        expect(appErr.status).toBe(422);
        expect(appErr.details?.reason).toBe('dose_increase');
        expect(appErr.details?.index).toBe(1);
        expect(appErr.details?.prevDose).toBe(20);
        expect(appErr.details?.currDose).toBe(30);
      }
    });
  });

  describe('Date ordering', () => {
    it('rejects out-of-order step dates', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-02-01', doseMg: 20 },
          { stepDate: '2026-01-15', doseMg: 15 }, // earlier than prev
        ]),
      ).toThrow(/precedes|out_of_order/i);
    });

    it('accepts steps with identical dates (same-day dose change)', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 30 },
          { stepDate: '2026-01-01', doseMg: 20 }, // same-day hold then drop
        ]),
      ).not.toThrow();
    });
  });

  describe('Input validation', () => {
    it('rejects non-array input', () => {
      expect(() => validateTaperSchedule(null)).toThrow(/array/);
      expect(() => validateTaperSchedule(undefined)).toThrow(/array/);
      expect(() => validateTaperSchedule({})).toThrow(/array/);
      expect(() => validateTaperSchedule('string')).toThrow(/array/);
    });

    it('rejects empty array', () => {
      expect(() => validateTaperSchedule([])).toThrow(/at least one step/);
    });

    it('rejects > 50 steps', () => {
      const massive = Array.from({ length: 51 }, (_, i) => ({
        stepDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
        doseMg: 50 - i,
      }));
      expect(() => validateTaperSchedule(massive)).toThrow(/max 50/);
    });

    it('rejects step with bad stepDate format', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '01/01/2026', doseMg: 20 },
        ]),
      ).toThrow(/YYYY-MM-DD|bad_step_date/);
    });

    it('rejects step with non-numeric dose', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: 'twenty' },
        ]),
      ).toThrow(/number|bad_dose_type/);
    });

    it('rejects step with NaN / Infinity dose', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: NaN },
        ]),
      ).toThrow();
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: Infinity },
        ]),
      ).toThrow();
    });

    it('rejects negative dose', () => {
      expect(() =>
        validateTaperSchedule([
          { stepDate: '2026-01-01', doseMg: -5 },
        ]),
      ).toThrow(/non-negative|negative_dose/);
    });

    it('rejects malformed step object', () => {
      expect(() =>
        validateTaperSchedule([
          null,
        ]),
      ).toThrow(/expected an object|bad_step_shape/);

      expect(() =>
        validateTaperSchedule([
          'string-not-object',
        ]),
      ).toThrow();
    });
  });
});
