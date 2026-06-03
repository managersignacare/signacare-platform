/**
 * Multi-specialty Phase 4 — Endocrinology pure-helper tests.
 *
 * Covers:
 *
 *   - computeTimeInRange: pure helper that bins glucose readings into
 *     the ATTD 2019 consensus bands (very low / low / in range / high /
 *     very high) and returns counts + percentages. Stamped on every
 *     /time-in-range response so the chart never re-bins on the
 *     frontend.
 *
 *   - CreateGlucoseReadingSchema and CreateInsulinRegimenSchema
 *     parsing rules: defaults, enum constraints, value ranges. These
 *     are the contract the frontend writes against, so a Zod
 *     regression would silently break the dialogs.
 */
import { describe, it, expect } from 'vitest';
import { computeTimeInRange } from '../src/features/endocrinology/glucoseService';
import {
  CreateGlucoseReadingSchema,
  CreateInsulinRegimenSchema,
} from '@signacare/shared';

const VALID_PATIENT_ID = '11111111-1111-1111-1111-111111111111';

// ── computeTimeInRange ───────────────────────────────────────────────────

describe('computeTimeInRange', () => {
  it('returns zeros + null mean for an empty input', () => {
    const out = computeTimeInRange([]);
    expect(out.totalReadings).toBe(0);
    expect(out.meanGlucose).toBeNull();
    expect(out.veryLowPct).toBe(0);
    expect(out.inRangePct).toBe(0);
    expect(out.veryHighPct).toBe(0);
  });

  it('bins ATTD bands correctly in mmol/L', () => {
    const readings = [
      { value: 2.5, unit: 'mmol/L' },  // very low
      { value: 3.5, unit: 'mmol/L' },  // low
      { value: 5.0, unit: 'mmol/L' },  // in range
      { value: 8.0, unit: 'mmol/L' },  // in range
      { value: 10.0, unit: 'mmol/L' }, // in range (boundary)
      { value: 12.0, unit: 'mmol/L' }, // high
      { value: 15.0, unit: 'mmol/L' }, // very high
    ];
    const out = computeTimeInRange(readings);
    expect(out.totalReadings).toBe(7);
    expect(out.veryLow).toBe(1);
    expect(out.low).toBe(1);
    expect(out.inRange).toBe(3);
    expect(out.high).toBe(1);
    expect(out.veryHigh).toBe(1);
  });

  it('converts mg/dL inputs to mmol/L before binning', () => {
    // 90 mg/dL ≈ 5.0 mmol/L (in range)
    // 270 mg/dL ≈ 15.0 mmol/L (very high)
    const readings = [
      { value: 90,  unit: 'mg/dL' },
      { value: 270, unit: 'mg/dL' },
    ];
    const out = computeTimeInRange(readings);
    expect(out.inRange).toBe(1);
    expect(out.veryHigh).toBe(1);
  });

  it('reports percentages with one-decimal precision', () => {
    const readings = Array.from({ length: 10 }, () => ({ value: 7.0, unit: 'mmol/L' }));
    readings[0] = { value: 2.0, unit: 'mmol/L' }; // very low
    const out = computeTimeInRange(readings);
    expect(out.totalReadings).toBe(10);
    expect(out.veryLowPct).toBe(10.0);
    expect(out.inRangePct).toBe(90.0);
  });

  it('computes mean glucose across mixed-unit readings', () => {
    const readings = [
      { value: 5.0, unit: 'mmol/L' },
      { value: 90,  unit: 'mg/dL' }, // ≈ 5.0
      { value: 7.0, unit: 'mmol/L' },
    ];
    const out = computeTimeInRange(readings);
    expect(out.meanGlucose).not.toBeNull();
    // Mean ≈ (5 + 4.995 + 7) / 3 ≈ 5.66
    expect(out.meanGlucose!).toBeGreaterThan(5.5);
    expect(out.meanGlucose!).toBeLessThan(5.8);
  });
});

// ── CreateGlucoseReadingSchema ────────────────────────────────────────────

describe('CreateGlucoseReadingSchema', () => {
  it('accepts a minimal payload and applies defaults', () => {
    const parsed = CreateGlucoseReadingSchema.parse({
      patientId: VALID_PATIENT_ID,
      value: 7.4,
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(parsed.unit).toBe('mmol/L');
    expect(parsed.source).toBe('fingerstick');
  });

  it('rejects an out-of-range value', () => {
    const result = CreateGlucoseReadingSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      value: 5000,
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid source enum', () => {
    const result = CreateGlucoseReadingSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      value: 7.0,
      source: 'guesstimate',
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative or zero values', () => {
    const r1 = CreateGlucoseReadingSchema.safeParse({ patientId: VALID_PATIENT_ID, value: 0,    measuredAt: '2026-04-12T08:00:00.000Z' });
    const r2 = CreateGlucoseReadingSchema.safeParse({ patientId: VALID_PATIENT_ID, value: -3.2, measuredAt: '2026-04-12T08:00:00.000Z' });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });
});

// ── CreateInsulinRegimenSchema ────────────────────────────────────────────

describe('CreateInsulinRegimenSchema', () => {
  it('accepts an empty payload (clears the regimen)', () => {
    const parsed = CreateInsulinRegimenSchema.parse({ patientId: VALID_PATIENT_ID });
    expect(parsed.patientId).toBe(VALID_PATIENT_ID);
  });

  it('accepts a complete bolus regimen', () => {
    const parsed = CreateInsulinRegimenSchema.parse({
      patientId: VALID_PATIENT_ID,
      basalDrug: 'glargine 100',
      basalDoseUnits: 24,
      basalFrequency: 'daily',
      bolusDrug: 'aspart',
      bolusDoses: { breakfast: 6, lunch: 8, dinner: 7 },
      correctionFactor: 2.5,
      carbRatio: 10,
      targetLow: 4.0,
      targetHigh: 8.0,
    });
    expect(parsed.bolusDoses?.breakfast).toBe(6);
    expect(parsed.targetLow).toBe(4.0);
  });

  it('rejects negative basal dose', () => {
    const result = CreateInsulinRegimenSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      basalDoseUnits: -5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects target ranges above the safe ceiling', () => {
    const result = CreateInsulinRegimenSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      targetHigh: 100,
    });
    expect(result.success).toBe(false);
  });
});
