import { describe, expect, it } from 'vitest';
import { PatientClinicalIntelligenceSummarySchema } from './patientClinicalIntelligence.schemas';

describe('patientClinicalIntelligence.schemas', () => {
  it('accepts a valid summary payload', () => {
    const parsed = PatientClinicalIntelligenceSummarySchema.parse({
      patientId: '11111111-1111-4111-8111-111111111111',
      now: {
        activeFlags: 1,
        highRiskFlags: 0,
        openTasks: 2,
        overdueTasks: 1,
        dnaLast90Days: 0,
      },
      due: {
        upcomingAppointments7Days: 1,
        overdueMhaReviews: 0,
        upcomingMhaReviews30Days: 1,
        overdueLaiAdministrations: 0,
        upcomingLaiAdministrations7Days: 1,
        overdue91DayReview: false,
        next91DayReviewDueDate: '2026-06-01',
      },
      trends: {
        daysSinceLastClinicalNote: 3,
        nextBirthdayInDays: 7,
        lastOutcomeScore: 11,
        previousOutcomeScore: 9,
        outcomeDirection: 'worsening',
      },
      meta: {
        generatedAt: '2026-05-20T10:00:00.000Z',
        failedSources: [],
        state: 'ok',
      },
    });

    expect(parsed.now.overdueTasks).toBe(1);
    expect(parsed.meta.state).toBe('ok');
  });

  it('rejects invalid state values', () => {
    const result = PatientClinicalIntelligenceSummarySchema.safeParse({
      patientId: '11111111-1111-4111-8111-111111111111',
      now: { activeFlags: 0, highRiskFlags: 0, openTasks: 0, overdueTasks: 0, dnaLast90Days: 0 },
      due: {
        upcomingAppointments7Days: 0,
        overdueMhaReviews: 0,
        upcomingMhaReviews30Days: 0,
        overdueLaiAdministrations: 0,
        upcomingLaiAdministrations7Days: 0,
        overdue91DayReview: true,
        next91DayReviewDueDate: null,
      },
      trends: {
        daysSinceLastClinicalNote: null,
        nextBirthdayInDays: null,
        lastOutcomeScore: null,
        previousOutcomeScore: null,
        outcomeDirection: 'unknown',
      },
      meta: {
        generatedAt: '2026-05-20T10:00:00.000Z',
        failedSources: ['tasks'],
        state: 'stale',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid next-review date format', () => {
    const result = PatientClinicalIntelligenceSummarySchema.safeParse({
      patientId: '11111111-1111-4111-8111-111111111111',
      now: { activeFlags: 0, highRiskFlags: 0, openTasks: 0, overdueTasks: 0, dnaLast90Days: 0 },
      due: {
        upcomingAppointments7Days: 0,
        overdueMhaReviews: 0,
        upcomingMhaReviews30Days: 0,
        overdueLaiAdministrations: 0,
        upcomingLaiAdministrations7Days: 0,
        overdue91DayReview: true,
        next91DayReviewDueDate: '20-05-2026',
      },
      trends: {
        daysSinceLastClinicalNote: null,
        nextBirthdayInDays: null,
        lastOutcomeScore: null,
        previousOutcomeScore: null,
        outcomeDirection: 'unknown',
      },
      meta: {
        generatedAt: '2026-05-20T10:00:00.000Z',
        failedSources: ['tasks'],
        state: 'partial',
      },
    });

    expect(result.success).toBe(false);
  });
});
