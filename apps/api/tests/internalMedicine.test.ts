/**
 * Multi-specialty Phase 3 — Internal Medicine pure-helper tests.
 *
 * Covers:
 *
 *   - MedRecService.reduceCounts: pure reducer that turns a med-rec
 *     snapshot into per-disposition counts. Stamped on every med-rec
 *     row at write time so reads never re-scan the JSONB.
 *
 *   - CreateProblemSchema parsing rules: defaults, enum constraints,
 *     date-string regex, severity nullability — these are the contract
 *     the frontend writes against, so a Zod regression would break the
 *     problem list dialog without a runtime error.
 *
 * Repository CRUD is exercised via integration tests in a separate
 * follow-up; unit-mocking the chained query builder for FHIR-style
 * cross joins offers diminishing returns vs. just running the routes
 * against the test database.
 */
import { describe, it, expect } from 'vitest';
import { MedRecService } from '../src/features/internal-medicine/medRecService';
import { CreateProblemSchema, type MedRecSnapshotItem } from '@signacare/shared';

describe('MedRecService.reduceCounts', () => {
  it('returns zeros for an empty snapshot', () => {
    expect(MedRecService.reduceCounts([])).toEqual({
      continued: 0, ceased: 0, modified: 0, new: 0, onHold: 0,
    });
  });

  it('counts each disposition independently', () => {
    const snapshot: MedRecSnapshotItem[] = [
      { drugLabel: 'metformin 500 mg BD',     disposition: 'continued' },
      { drugLabel: 'sertraline 50 mg daily',  disposition: 'continued' },
      { drugLabel: 'amitriptyline 25 mg nocte', disposition: 'ceased' },
      { drugLabel: 'lisinopril 5 mg → 10 mg', disposition: 'modified' },
      { drugLabel: 'atorvastatin 20 mg',      disposition: 'new' },
      { drugLabel: 'warfarin (held pre-op)',  disposition: 'on-hold' },
    ];
    expect(MedRecService.reduceCounts(snapshot)).toEqual({
      continued: 2, ceased: 1, modified: 1, new: 1, onHold: 1,
    });
  });

  it('ignores items whose disposition is unrecognised', () => {
    const snapshot = [
      { drugLabel: 'A', disposition: 'continued' },
      { drugLabel: 'B', disposition: 'something-bogus' as unknown },
    ] as unknown as MedRecSnapshotItem[];
    expect(MedRecService.reduceCounts(snapshot)).toEqual({
      continued: 1, ceased: 0, modified: 0, new: 0, onHold: 0,
    });
  });
});

describe('CreateProblemSchema', () => {
  const VALID_PATIENT_ID = '11111111-1111-1111-1111-111111111111';

  it('accepts a minimal payload and applies the documented defaults', () => {
    const parsed = CreateProblemSchema.parse({
      patientId: VALID_PATIENT_ID,
      code: 'E11.9',
      display: 'Type 2 diabetes mellitus without complications',
    });
    expect(parsed.codeSystem).toBe('snomed');
    expect(parsed.category).toBe('problem-list-item');
    expect(parsed.clinicalStatus).toBe('active');
    expect(parsed.verificationStatus).toBe('confirmed');
    expect(parsed.isChronic).toBe(false);
  });

  it('rejects an invalid clinical_status', () => {
    const result = CreateProblemSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      code: 'E11.9',
      display: 'Type 2 DM',
      clinicalStatus: 'mostly-better',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed onset date', () => {
    const result = CreateProblemSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      code: 'E11.9',
      display: 'Type 2 DM',
      onsetDate: '12/04/2025',
    });
    expect(result.success).toBe(false);
  });

  it('allows severity to be null', () => {
    const parsed = CreateProblemSchema.parse({
      patientId: VALID_PATIENT_ID,
      code: 'I10',
      display: 'Essential hypertension',
      severity: null,
    });
    expect(parsed.severity).toBeNull();
  });

  it('caps onset age years at 120', () => {
    const result = CreateProblemSchema.safeParse({
      patientId: VALID_PATIENT_ID,
      code: 'X', display: 'X',
      onsetAgeYears: 200,
    });
    expect(result.success).toBe(false);
  });
});
