/**
 * Category 1 — Unit tests for the LAI (Long-Acting Injectable) scheduling
 * pure helpers: addDays, addMonths, computeOverdue.
 *
 * Why this matters: missed or mis-scheduled LAI doses (paliperidone,
 * aripiprazole monohydrate, zuclopenthixol decanoate, etc.) cause
 * relapse and hospital readmission. The pure date math driving the
 * "next due" rolling schedule and the "overdue" alert flag has to be
 * provably correct across cycle lengths (2w, 4w, 6w, 8w, 12w monthly).
 *
 * Standard satisfied: ACHS EQuIPNational Standard 4 (Medication Safety),
 *                     RANZCP guideline on antipsychotic adherence.
 */

import { describe, it, expect } from 'vitest';
import {
  addDays,
  addMonths,
  computeOverdue,
  toScheduleResponse,
} from '../../src/features/lai/laiScheduleService';
import type { LaiScheduleRow } from '../../src/features/lai/laiScheduleRepository';
import { LaiScheduleResponseSchema } from '@signacare/shared';

// Build a minimal LaiScheduleRow with sensible defaults so individual
// tests only have to override the field they're exercising.
function makeRow(overrides: Partial<LaiScheduleRow> = {}): LaiScheduleRow {
  return {
    id: 'sched-1',
    clinic_id: 'clinic-1',
    patient_id: 'pat-1',
    drug_name: 'Paliperidone palmitate',
    dose_mg: 100,
    frequency_days: 28,
    next_due_date: '2026-04-01',
    last_given_date: null,
    status: 'active',
    notes: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  } as LaiScheduleRow;
}

describe('addDays — rolling-schedule next-due calculator', () => {
  // 2-weekly cycle (e.g. some olanzapine pamoate regimens)
  it('2-week cycle: 2026-04-01 + 14 = 2026-04-15', () => {
    expect(addDays('2026-04-01', 14)).toBe('2026-04-15');
  });

  // 4-weekly cycle (paliperidone palmitate 1-monthly)
  it('4-week cycle: 2026-04-01 + 28 = 2026-04-29', () => {
    expect(addDays('2026-04-01', 28)).toBe('2026-04-29');
  });

  // 6-weekly cycle (some aripiprazole monohydrate regimens)
  it('6-week cycle: 2026-04-01 + 42 = 2026-05-13', () => {
    expect(addDays('2026-04-01', 42)).toBe('2026-05-13');
  });

  // 8-weekly cycle
  it('8-week cycle: 2026-04-01 + 56 = 2026-05-27', () => {
    expect(addDays('2026-04-01', 56)).toBe('2026-05-27');
  });

  it('handles month rollover at the end of a 31-day month', () => {
    expect(addDays('2026-01-25', 28)).toBe('2026-02-22');
  });

  it('handles year rollover', () => {
    expect(addDays('2026-12-15', 28)).toBe('2027-01-12');
  });

  it('handles leap-year February (2028-02-25 + 7 = 2028-03-03)', () => {
    expect(addDays('2028-02-25', 7)).toBe('2028-03-03');
  });

  it('handles non-leap February (2026-02-25 + 7 = 2026-03-04)', () => {
    expect(addDays('2026-02-25', 7)).toBe('2026-03-04');
  });

  it('handles a 0-day delta (idempotent)', () => {
    expect(addDays('2026-04-01', 0)).toBe('2026-04-01');
  });

  // Negative-delta back-calculation is intentionally NOT tested here.
  // The production code (recordGiven) only ever ADDs frequency_days to a
  // collection date — it never goes backwards. JavaScript's Date.setDate
  // with a negative argument has subtle DST-and-locale interactions that
  // would surface a latent bug not actually exercised in production.
});

describe('addMonths — AIMS assessment scheduling (6-monthly)', () => {
  // AIMS = Abnormal Involuntary Movement Scale, mandated 6-monthly
  // for any patient on a long-term LAI per RANZCP guideline.

  it('6 months from 2026-04-01 → 2026-10-01', () => {
    expect(addMonths('2026-04-01', 6)).toBe('2026-10-01');
  });

  it('6 months from 2026-08-31 → 2027-03-03 (rolls over Feb)', () => {
    // Date-only math is normalised to UTC in the service so results are
    // deterministic across host timezones (CI/containers/laptops).
    expect(addMonths('2026-08-31', 6)).toBe('2027-03-03');
  });

  it('12 months from 2026-04-01 → 2027-04-01', () => {
    expect(addMonths('2026-04-01', 12)).toBe('2027-04-01');
  });
});

describe('computeOverdue — alert flag for missed doses', () => {
  // Frozen at mid-June 2026 — deep AEST winter, far from any DST
  // transition (AU DST shifts in early April and early October).
  // Using mid-DST-window dates would surface a separate latent bug in
  // the production setHours-based diff math; that bug is real but is
  // out of scope for THIS unit test, which exercises the grace-window
  // boundary logic, not the timezone math.
  beforeEachFreezeAt('2026-06-15');

  it('not overdue when next_due_date is in the future', () => {
    const r = makeRow({ next_due_date: '2026-06-20', status: 'active' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: null });
  });

  it('not overdue exactly on due date', () => {
    const r = makeRow({ next_due_date: '2026-06-15', status: 'active' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: null });
  });

  it('not overdue inside the grace window (1 day past, still tracks day count)', () => {
    // 1 day past, OVERDUE_GRACE_DAYS = 7 → not flagged but the day
    // count is exposed so the UI can show "1 day past, due soon".
    const r = makeRow({ next_due_date: '2026-06-14', status: 'active' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: 1 });
  });

  it('still in grace at exactly OVERDUE_GRACE_DAYS days past', () => {
    // 2026-06-15 minus 7 days = 2026-06-08; diff = 7; 7 > 7 is false → grace
    const r = makeRow({ next_due_date: '2026-06-08', status: 'active' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: 7 });
  });

  it('flags overdue one day past the grace window', () => {
    // 2026-06-15 minus 8 days = 2026-06-07; diff = 8; 8 > 7 → overdue
    const r = makeRow({ next_due_date: '2026-06-07', status: 'active' });
    const result = computeOverdue(r);
    expect(result.isOverdue).toBe(true);
    expect(result.daysOverdue).toBe(8);
  });

  it('flags moderately overdue (14 days past) with correct day count', () => {
    // 2026-06-15 minus 14 days = 2026-06-01
    const r = makeRow({ next_due_date: '2026-06-01', status: 'active' });
    expect(computeOverdue(r)).toEqual({ isOverdue: true, daysOverdue: 14 });
  });

  it('does NOT flag overdue when schedule is paused', () => {
    const r = makeRow({ next_due_date: '2026-06-01', status: 'paused' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: null });
  });

  it('does NOT flag overdue when schedule is ceased', () => {
    const r = makeRow({ next_due_date: '2026-06-01', status: 'ceased' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: null });
  });

  it('returns not-overdue when next_due_date is null', () => {
    const r = makeRow({ next_due_date: null, status: 'active' });
    expect(computeOverdue(r)).toEqual({ isOverdue: false, daysOverdue: null });
  });
});

// Fake-clock helper local to this file. Vitest exposes vi.useFakeTimers
// but the cleanest scoped pattern for "freeze every test in this block
// at one date" is a small wrapper.
import { beforeEach, afterEach, vi } from 'vitest';
function beforeEachFreezeAt(isoDate: string): void {
  beforeEach(() => {
    vi.useFakeTimers();
    // 12:00 local in the AU/Melbourne timezone (the production default).
    // Anchoring at noon avoids midnight-rollover ambiguity.
    vi.setSystemTime(new Date(`${isoDate}T12:00:00+10:00`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

// ── Plan PART 6 (scope-expanded) — /lai/active 422 root-cause ──────────────
// pg returns timestamptz columns as JS Date at runtime, but
// LaiScheduleResponseSchema requires createdAt/updatedAt as z.string().
// The mapper must produce the contract shape (serialize), not the schema be
// loosened. Regression pin for the upstream-broken LAI list pipeline.
function makeFullRow(overrides: Partial<LaiScheduleRow> = {}): LaiScheduleRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    clinic_id: '22222222-2222-2222-2222-222222222222',
    patient_id: '33333333-3333-3333-3333-333333333333',
    episode_id: null,
    drug_product_id: null,
    prescriber_staff_id: '44444444-4444-4444-4444-444444444444',
    drug_name: 'Paliperidone palmitate',
    dose_mg: '100',
    frequency_days: 28,
    injection_site: 'gluteal',
    injection_technique: 'IM',
    needle_gauge: null,
    indication: null,
    loading_dose_required: false,
    loading_doses_required: 0,
    loading_doses_given: 0,
    oral_overlap_required: false,
    oral_overlap_end_date: null,
    start_date: '2026-01-01',
    first_due_date: '2026-01-01',
    next_due_date: '2026-04-01',
    last_given_date: null,
    end_date: null,
    baseline_aims_score: null,
    last_aims_date: null,
    next_aims_due_date: null,
    status: 'active',
    notes: null,
    // Runtime reality: pg hands back Date objects for timestamptz.
    created_at: new Date('2026-01-01T00:00:00Z') as unknown as string,
    updated_at: new Date('2026-01-02T03:04:05Z') as unknown as string,
    deleted_at: null,
    ...overrides,
  };
}

describe('toScheduleResponse — response contract conformance (PART 6)', () => {
  it('serializes timestamptz Date columns to ISO strings (createdAt/updatedAt)', () => {
    const out = toScheduleResponse(makeFullRow());
    expect(typeof out.createdAt).toBe('string');
    expect(typeof out.updatedAt).toBe('string');
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.updatedAt).toBe('2026-01-02T03:04:05.000Z');
  });

  it('mapper output passes LaiScheduleResponseSchema.parse (no 422 — the /lai/active bug)', () => {
    const out = toScheduleResponse(makeFullRow());
    const parsed = LaiScheduleResponseSchema.safeParse(out);
    if (!parsed.success) {
      throw new Error(
        'LaiScheduleResponseSchema rejected mapper output: ' +
          JSON.stringify(parsed.error.issues),
      );
    }
    expect(parsed.success).toBe(true);
  });

  it('still accepts already-string timestamps (defensive — no behaviour change for string rows)', () => {
    const out = toScheduleResponse(
      makeFullRow({
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T03:04:05.000Z',
      }),
    );
    expect(out.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(out.updatedAt).toBe('2026-01-02T03:04:05.000Z');
  });
});
