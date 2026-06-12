import type { DurableClinicalAiJobAction } from '@signacare/shared';
import { apiClient } from './apiClient';
import { normalizeClinicalAiJobSubmitError } from './llmAiJobsSupport';

export const CLINICAL_AI_JOB_POLL_INTERVAL_MS = 5_000;
export const CLINICAL_AI_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const CLINICAL_AI_JOB_QUEUED_EVENT = 'signacare:clinical-ai-job-queued';
export const CLINICAL_AI_JOB_RECOVERY_STORAGE_KEY = 'signacare:clinical-ai-job-recovery-v1';
const MAX_RECOVERY_JOBS = 25;

export type ClinicalAiJobAction = DurableClinicalAiJobAction;

export interface ClinicalAiJobSubmitInput {
  action: ClinicalAiJobAction;
  data: string | Record<string, unknown>;
  model?: string;
  patientId?: string;
  episodeId?: string;
  enhance?: boolean | 'draft';
  templateType?: string;
}

export interface ClinicalAiJobQueued {
  jobId: string;
  action: ClinicalAiJobAction | string;
  status: 'queued';
  message: string;
}

export interface ClinicalAiJobStatus {
  jobId: string;
  action: ClinicalAiJobAction | string;
  patientId?: string | null;
  status: string;
  result?: string | null;
  resultJson?: unknown;
  validated?: boolean;
  validationWarnings?: unknown;
  completedAt?: string | Date | null;
  failedReason?: string | null;
  progress?: number | object | null;
  stage?: string | null;
  statusMessage?: string | null;
  queuedAt?: string | Date | null;
  startedAt?: string | Date | null;
  failedAt?: string | Date | null;
  durationMs?: number | null;
}

export interface ClinicalAiJobListItem {
  jobId: string;
  action: ClinicalAiJobAction | string;
  patientId?: string | null;
  status: string;
  submittedAt?: string | Date | null;
  progress?: number | object | null;
  stage?: string | null;
  statusMessage?: string | null;
  completedAt?: string | Date | null;
  failedAt?: string | Date | null;
}

export interface ClinicalAiJobListResponse {
  jobs: ClinicalAiJobListItem[];
}

export interface ClinicalAiJobListInput {
  patientId?: string;
  action: ClinicalAiJobAction | 'ambient-audio';
}

export interface ClinicalAiJobCompletedResult {
  jobId: string;
  result: string;
  status: ClinicalAiJobStatus;
}

export interface ClinicalAiJobRecoveryRecord {
  jobId: string;
  action: ClinicalAiJobAction | string;
  patientId?: string | null;
  queuedAt: string;
}

export class ClinicalAiJobTimeoutError extends Error {
  readonly jobId: string;
  readonly lastStatus?: ClinicalAiJobStatus;

  constructor(jobId: string, lastStatus?: ClinicalAiJobStatus) {
    super(`Clinical AI job ${jobId} is still running after the polling window.`);
    this.name = 'ClinicalAiJobTimeoutError';
    this.jobId = jobId;
    this.lastStatus = lastStatus;
    Object.setPrototypeOf(this, ClinicalAiJobTimeoutError.prototype);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function actionLabel(action: ClinicalAiJobAction): string {
  switch (action) {
    case 'maudsley':
      return 'AI summary generation';
    case 'formulation':
      return 'AI formulation generation';
    case 'discharge':
      return 'AI discharge summary generation';
    case '5p-formulation':
      return 'AI 5P formulation generation';
    case 'letter':
      return 'AI letter generation';
    default:
      return 'Async AI generation';
  }
}

function readRecoveryRecords(): ClinicalAiJobRecoveryRecord[] {
  try {
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    const raw = storage?.getItem(CLINICAL_AI_JOB_RECOVERY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ClinicalAiJobRecoveryRecord =>
      item !== null
      && typeof item === 'object'
      && typeof (item as ClinicalAiJobRecoveryRecord).jobId === 'string'
      && typeof (item as ClinicalAiJobRecoveryRecord).action === 'string'
      && typeof (item as ClinicalAiJobRecoveryRecord).queuedAt === 'string',
    );
  } catch {
    return [];
  }
}

function recordQueuedJobForRecovery(record: ClinicalAiJobRecoveryRecord): void {
  try {
    const storage = typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
    if (storage) {
      const withoutDuplicate = readRecoveryRecords().filter((item) => item.jobId !== record.jobId);
      storage.setItem(
        CLINICAL_AI_JOB_RECOVERY_STORAGE_KEY,
        JSON.stringify([record, ...withoutDuplicate].slice(0, MAX_RECOVERY_JOBS)),
      );
    }
  } catch {
    // Recovery storage is best-effort. The server-side job remains durable.
  }

  try {
    if (
      typeof globalThis.dispatchEvent === 'function'
      && typeof globalThis.CustomEvent === 'function'
    ) {
      globalThis.dispatchEvent(new CustomEvent(CLINICAL_AI_JOB_QUEUED_EVENT, { detail: record }));
    }
  } catch {
    // Older test/browser shells may not support CustomEvent. Do not block the job.
  }
}

export const llmAiJobsApi = {
  queueClinicalAiJob: async (input: ClinicalAiJobSubmitInput): Promise<ClinicalAiJobQueued> => {
    try {
      const queued = await apiClient.post<ClinicalAiJobQueued>('ai/jobs', input);
      recordQueuedJobForRecovery({
        jobId: queued.jobId,
        action: queued.action,
        patientId: input.patientId ?? null,
        queuedAt: new Date().toISOString(),
      });
      return queued;
    } catch (err) {
      throw normalizeClinicalAiJobSubmitError(err, actionLabel(input.action));
    }
  },

  getAiJobStatus: (jobId: string): Promise<ClinicalAiJobStatus> =>
    apiClient.get<ClinicalAiJobStatus>(`ai/jobs/${jobId}`),

  listAiJobs: (input: ClinicalAiJobListInput): Promise<ClinicalAiJobListResponse> =>
    apiClient.get<ClinicalAiJobListResponse>('ai/jobs', {
      action: input.action,
      ...(input.patientId ? { patientId: input.patientId } : {}),
    }),

  waitForClinicalAiJob: async (
    jobId: string,
    opts: {
      intervalMs?: number;
      timeoutMs?: number;
      onProgress?: (status: ClinicalAiJobStatus) => void;
    } = {},
  ): Promise<ClinicalAiJobCompletedResult> => {
    const intervalMs = opts.intervalMs ?? CLINICAL_AI_JOB_POLL_INTERVAL_MS;
    const timeoutMs = opts.timeoutMs ?? CLINICAL_AI_JOB_TIMEOUT_MS;
    const startedAt = Date.now();
    let lastStatus: ClinicalAiJobStatus | undefined;

    while (Date.now() - startedAt < timeoutMs) {
      const status = await llmAiJobsApi.getAiJobStatus(jobId);
      lastStatus = status;
      opts.onProgress?.(status);

      if (status.status === 'failed') {
        throw new Error(status.failedReason || status.statusMessage || 'Clinical AI job failed.');
      }
      if (status.status === 'completed') {
        const result = status.result?.trim();
        if (result) return { jobId, result, status };
        throw new Error('Clinical AI job completed without generated text.');
      }

      await delay(intervalMs);
    }

    throw new ClinicalAiJobTimeoutError(jobId, lastStatus);
  },

  runClinicalAiJob: async (
    input: ClinicalAiJobSubmitInput,
    opts: {
      intervalMs?: number;
      timeoutMs?: number;
      onProgress?: (status: ClinicalAiJobStatus) => void;
    } = {},
  ): Promise<string> => {
    const queued = await llmAiJobsApi.queueClinicalAiJob(input);
    const completed = await llmAiJobsApi.waitForClinicalAiJob(queued.jobId, opts);
    return completed.result;
  },

  runClinicalAiJobDetailed: async (
    input: ClinicalAiJobSubmitInput,
    opts: {
      intervalMs?: number;
      timeoutMs?: number;
      onProgress?: (status: ClinicalAiJobStatus) => void;
    } = {},
  ): Promise<ClinicalAiJobStatus> => {
    const queued = await llmAiJobsApi.queueClinicalAiJob(input);
    const completed = await llmAiJobsApi.waitForClinicalAiJob(queued.jobId, opts);
    return completed.status;
  },
};
