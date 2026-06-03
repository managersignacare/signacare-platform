/*
 * apps/api/tests/unit/treatmentPathwaySchemas.test.ts
 *
 * BUG-402 — Zod-boundary contract tests for treatment-pathway opt-locking.
 *
 * The opt-lock helper (`updateWithOptimisticLock`) is invariant-tested in
 * `apps/api/tests/unit/optimisticLock.test.ts`. This file pins the
 * REQUIRED-at-Zod-boundary posture chosen for treatment_pathways:
 *   - Update + record-session DTOs MUST carry expectedLockVersion.
 *   - Response DTO MUST surface lockVersion so clients can echo it back.
 *
 * Asymmetric posture rationale (per plan):
 *   - episodes (BUG-371c) used OPTIONAL+warn because legacy mobile
 *     clients exist with no echo path.
 *   - treatment_pathways has only 2 web mutators (PathwaysTab,
 *     PathwaysPage) and zero mobile/external clients — atomic REQUIRED
 *     flip is safe and removes the silent-stale-write class outright.
 */
import { describe, it, expect } from 'vitest';
import {
  AssignPathwayInterventionSchema,
  CreatePathwaySleepHygieneCheckInSchema,
  CreatePathwayThoughtDiaryEntrySchema,
  PathwayDigitalInterventionBundleSchema,
  UpdateTreatmentPathwaySchema,
  RecordSessionSchema,
  TreatmentPathwayResponseSchema,
  UpdatePathwayInterventionItemSchema,
} from '@signacare/shared';

describe('BUG-402 treatment-pathway Zod schemas', () => {
  it('TP-ZOD-1: UpdateTreatmentPathwaySchema rejects when expectedLockVersion missing', () => {
    const result = UpdateTreatmentPathwaySchema.safeParse({
      status: 'completed',
      endDate: '2026-04-26',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/expectedLockVersion/);
    }
  });

  it('TP-ZOD-2: UpdateTreatmentPathwaySchema accepts positive int expectedLockVersion', () => {
    const result = UpdateTreatmentPathwaySchema.safeParse({
      status: 'completed',
      endDate: '2026-04-26',
      expectedLockVersion: 1,
    });
    expect(result.success).toBe(true);
  });

  it('TP-ZOD-3: RecordSessionSchema rejects when expectedLockVersion missing', () => {
    const result = RecordSessionSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/expectedLockVersion/);
    }
  });

  it('TP-ZOD-4: RecordSessionSchema rejects expectedLockVersion <= 0', () => {
    expect(RecordSessionSchema.safeParse({ expectedLockVersion: 0 }).success).toBe(false);
    expect(RecordSessionSchema.safeParse({ expectedLockVersion: -1 }).success).toBe(false);
    expect(RecordSessionSchema.safeParse({ expectedLockVersion: 1.5 }).success).toBe(false);
    expect(RecordSessionSchema.safeParse({ expectedLockVersion: 1 }).success).toBe(true);
  });

  it('TP-ZOD-5: TreatmentPathwayResponseSchema requires lockVersion (so client can echo it)', () => {
    const minimal = {
      id: '00000000-0000-0000-0000-000000000001',
      patientId: '00000000-0000-0000-0000-000000000002',
      clinicId: '00000000-0000-0000-0000-000000000003',
      pathwayType: 'cbt',
      pathwayName: 'CBT',
      status: 'active',
      totalSessions: 12,
      completedSessions: 0,
      startDate: '2026-04-26',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    };
    const withoutLockVersion = TreatmentPathwayResponseSchema.safeParse(minimal);
    expect(withoutLockVersion.success).toBe(false);
    const withLockVersion = TreatmentPathwayResponseSchema.safeParse({
      ...minimal,
      lockVersion: 1,
    });
    expect(withLockVersion.success).toBe(true);
  });

  it('TP-ZOD-6: assign intervention requires lockVersion + valid template key', () => {
    expect(
      AssignPathwayInterventionSchema.safeParse({
        templateKey: 'cbt_homework',
      }).success,
    ).toBe(false);
    expect(
      AssignPathwayInterventionSchema.safeParse({
        expectedLockVersion: 1,
        templateKey: 'cbt_homework',
      }).success,
    ).toBe(true);
    expect(
      AssignPathwayInterventionSchema.safeParse({
        expectedLockVersion: 1,
        templateKey: 'unsupported_template',
      }).success,
    ).toBe(false);
  });

  it('TP-ZOD-7: intervention item completion requires optimistic-lock echo', () => {
    expect(
      UpdatePathwayInterventionItemSchema.safeParse({
        completed: true,
      }).success,
    ).toBe(false);
    expect(
      UpdatePathwayInterventionItemSchema.safeParse({
        expectedLockVersion: 2,
        completed: false,
      }).success,
    ).toBe(true);
  });

  it('TP-ZOD-8: thought diary entry contract enforces core fields', () => {
    const missing = CreatePathwayThoughtDiaryEntrySchema.safeParse({
      expectedLockVersion: 1,
      situation: '',
      automaticThought: 'I will fail',
      emotion: 'anxiety',
      emotionIntensity: 90,
    });
    expect(missing.success).toBe(false);
    const valid = CreatePathwayThoughtDiaryEntrySchema.safeParse({
      expectedLockVersion: 1,
      situation: 'Upcoming MDT review',
      automaticThought: 'I am not ready',
      emotion: 'anxiety',
      emotionIntensity: 80,
      balancedThought: 'I can prepare one step at a time',
    });
    expect(valid.success).toBe(true);
  });

  it('TP-ZOD-9: sleep hygiene check-in contract validates local times + sleep quality', () => {
    const invalid = CreatePathwaySleepHygieneCheckInSchema.safeParse({
      expectedLockVersion: 1,
      bedtime: '25:10',
      sleepQuality: 7,
      caffeineAfterNoon: true,
      screenAfterBed: true,
      exerciseDone: false,
    });
    expect(invalid.success).toBe(false);
    const valid = CreatePathwaySleepHygieneCheckInSchema.safeParse({
      expectedLockVersion: 1,
      bedtime: '22:30',
      wakeTime: '06:30',
      sleepHours: 7.25,
      sleepQuality: 4,
      caffeineAfterNoon: false,
      screenAfterBed: false,
      exerciseDone: true,
    });
    expect(valid.success).toBe(true);
  });

  it('TP-ZOD-10: digital bundle response requires lockVersion + typed arrays', () => {
    const parsed = PathwayDigitalInterventionBundleSchema.safeParse({
      pathwayId: '00000000-0000-0000-0000-000000000111',
      lockVersion: 3,
      packs: [],
      thoughtDiaryEntries: [],
      sleepJourneyCheckIns: [],
    });
    expect(parsed.success).toBe(true);
  });
});
