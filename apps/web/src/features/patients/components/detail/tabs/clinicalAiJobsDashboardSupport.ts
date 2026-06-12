import type { ClinicalAiJobListItem } from '../../../../../shared/services/llmAiJobsApi';

export const ACTIVE_CLINICAL_AI_STATUSES = new Set([
  'queued',
  'processing',
  'retrying',
  'generating',
  'transcribing',
  'validating',
]);

export interface DashboardScopedClinicalAiJob extends ClinicalAiJobListItem {
  groupKey: string;
}

export function isActiveClinicalAiJobStatus(status: string): boolean {
  return ACTIVE_CLINICAL_AI_STATUSES.has(status);
}

export function sortClinicalAiJobTime(job: ClinicalAiJobListItem): number {
  const value = job.completedAt ?? job.failedAt ?? job.submittedAt;
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function collapseSupersededDashboardJobs<T extends DashboardScopedClinicalAiJob>(jobs: T[]): T[] {
  const latestActiveByGroup = new Map<string, T>();

  for (const job of jobs) {
    if (!isActiveClinicalAiJobStatus(job.status)) continue;
    const existing = latestActiveByGroup.get(job.groupKey);
    if (!existing || sortClinicalAiJobTime(job) >= sortClinicalAiJobTime(existing)) {
      latestActiveByGroup.set(job.groupKey, job);
    }
  }

  if (latestActiveByGroup.size === 0) return jobs;

  return jobs.filter((job) => {
    const latestActive = latestActiveByGroup.get(job.groupKey);
    if (!latestActive) return true;
    return job.jobId === latestActive.jobId;
  });
}
