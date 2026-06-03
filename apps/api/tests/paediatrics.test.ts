/**
 * Multi-specialty Phase 5 — Paediatrics schema unit tests.
 *
 * Pure parsing tests for the three Create DTOs. These are the
 * contract the frontend writes against, so a Zod regression would
 * silently break the dialogs.
 */
import { describe, it, expect } from 'vitest';
import {
  CreateGrowthMeasurementSchema,
  CreateImmunizationSchema,
  CreateMilestoneSchema,
} from '@signacare/shared';

const VALID_PATIENT_ID = '11111111-1111-1111-1111-111111111111';

// ── CreateGrowthMeasurementSchema ─────────────────────────────────────────

describe('CreateGrowthMeasurementSchema', () => {
  it('accepts a minimal weight payload', () => {
    const parsed = CreateGrowthMeasurementSchema.parse({
      patientId: VALID_PATIENT_ID,
      measurementType: 'weight_kg',
      value: 12.4,
      unit: 'kg',
      ageAtMeasurementDays: 365,
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(parsed.measurementType).toBe('weight_kg');
    expect(parsed.value).toBe(12.4);
  });

  it('rejects a negative value', () => {
    const result = CreateGrowthMeasurementSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      measurementType: 'weight_kg',
      value: -2,
      unit: 'kg',
      ageAtMeasurementDays: 100,
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range age (>= 100 years)', () => {
    const result = CreateGrowthMeasurementSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      measurementType: 'weight_kg',
      value: 70,
      unit: 'kg',
      ageAtMeasurementDays: 100_000, // > 36524 (100y)
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown measurement_type', () => {
    const result = CreateGrowthMeasurementSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      measurementType: 'arm_span',
      value: 65,
      unit: 'cm',
      ageAtMeasurementDays: 1000,
      measuredAt: '2026-04-12T08:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('clamps z-score to [-10, 10]', () => {
    const result = CreateGrowthMeasurementSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      measurementType: 'weight_kg',
      value: 12,
      unit: 'kg',
      ageAtMeasurementDays: 200,
      measuredAt: '2026-04-12T08:00:00.000Z',
      zScore: 99,
    });
    expect(result.success).toBe(false);
  });
});

// ── CreateImmunizationSchema ──────────────────────────────────────────────

describe('CreateImmunizationSchema', () => {
  it('accepts a minimal payload and defaults status to completed', () => {
    const parsed = CreateImmunizationSchema.parse({
      patientId: VALID_PATIENT_ID,
      cvxCode: '20',
      vaccineName: 'DTaP',
      administeredDate: '2026-04-12',
    });
    expect(parsed.status).toBe('completed');
  });

  it('rejects a malformed administered date', () => {
    const result = CreateImmunizationSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      cvxCode: '20',
      vaccineName: 'DTaP',
      administeredDate: '12/04/2026',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown site', () => {
    const result = CreateImmunizationSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      cvxCode: '20',
      vaccineName: 'DTaP',
      administeredDate: '2026-04-12',
      site: 'forearm',
    });
    expect(result.success).toBe(false);
  });

  it('rejects dose_number out of range', () => {
    const result = CreateImmunizationSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      cvxCode: '20',
      vaccineName: 'DTaP',
      administeredDate: '2026-04-12',
      doseNumber: 99,
    });
    expect(result.success).toBe(false);
  });
});

// ── CreateMilestoneSchema ─────────────────────────────────────────────────

describe('CreateMilestoneSchema', () => {
  it('accepts a minimal payload and defaults status to not_assessed', () => {
    const parsed = CreateMilestoneSchema.parse({
      patientId: VALID_PATIENT_ID,
      domain: 'gross_motor',
      milestone: 'Sits without support',
    });
    expect(parsed.status).toBe('not_assessed');
  });

  it('accepts a fully populated achieved milestone', () => {
    const parsed = CreateMilestoneSchema.parse({
      patientId: VALID_PATIENT_ID,
      domain: 'language',
      milestone: 'First words',
      expectedAgeMonths: 12,
      achievedAtMonths: 11,
      status: 'achieved',
      note: 'Mum reports mama and dada',
    });
    expect(parsed.status).toBe('achieved');
    expect(parsed.achievedAtMonths).toBe(11);
  });

  it('rejects an unknown domain', () => {
    const result = CreateMilestoneSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      domain: 'spiritual',
      milestone: 'Empathy',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range age in months', () => {
    const result = CreateMilestoneSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      domain: 'gross_motor',
      milestone: 'Walks alone',
      expectedAgeMonths: 999,
    });
    expect(result.success).toBe(false);
  });
});
