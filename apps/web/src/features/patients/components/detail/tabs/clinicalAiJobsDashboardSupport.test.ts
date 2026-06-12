import { describe, expect, it } from 'vitest';
import {
  collapseSupersededDashboardJobs,
  isActiveClinicalAiJobStatus,
} from './clinicalAiJobsDashboardSupport';

describe('clinicalAiJobsDashboardSupport', () => {
  it('treats generating and validating statuses as active jobs', () => {
    expect(isActiveClinicalAiJobStatus('generating')).toBe(true);
    expect(isActiveClinicalAiJobStatus('validating')).toBe(true);
    expect(isActiveClinicalAiJobStatus('failed')).toBe(false);
  });

  it('hides superseded older jobs when a newer active job exists for the same dashboard section', () => {
    const jobs = collapseSupersededDashboardJobs([
      {
        groupKey: 'summary',
        jobId: 'failed-old',
        action: 'maudsley',
        status: 'failed',
        submittedAt: '2026-06-07T03:18:06.000Z',
        failedAt: '2026-06-07T03:21:06.000Z',
      },
      {
        groupKey: 'summary',
        jobId: 'active-new',
        action: 'maudsley',
        status: 'generating',
        submittedAt: '2026-06-07T03:45:29.000Z',
      },
      {
        groupKey: 'formulation',
        jobId: 'formulation-failed',
        action: 'formulation',
        status: 'failed',
        submittedAt: '2026-06-07T03:10:00.000Z',
      },
    ]);

    expect(jobs.map((job) => job.jobId)).toEqual(['active-new', 'formulation-failed']);
  });

  it('preserves historical jobs when there is no newer active replacement', () => {
    const jobs = collapseSupersededDashboardJobs([
      {
        groupKey: 'summary',
        jobId: 'completed-a',
        action: 'maudsley',
        status: 'completed',
        submittedAt: '2026-06-07T03:00:00.000Z',
        completedAt: '2026-06-07T03:02:00.000Z',
      },
      {
        groupKey: 'summary',
        jobId: 'failed-b',
        action: 'maudsley',
        status: 'failed',
        submittedAt: '2026-06-07T03:10:00.000Z',
        failedAt: '2026-06-07T03:11:00.000Z',
      },
    ]);

    expect(jobs.map((job) => job.jobId)).toEqual(['completed-a', 'failed-b']);
  });
});
