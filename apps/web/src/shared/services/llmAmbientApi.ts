import { apiClient } from './apiClient';
import type { LLMSoapResponse, AmbientNoteResult } from '../types/llmTypes';

export const AMBIENT_NOTE_HTTP_TIMEOUT_MS = 210 * 1000;
export const AMBIENT_NOTE_JOB_POLL_INTERVAL_MS = 5_000;
export const AMBIENT_NOTE_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const UUIDISH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const AMBIENT_NOTE_FORMATS = [
  'soap',
  'mse',
  'progress',
  'intake',
  'all',
  'ward_round',
  'review',
  'collateral',
  'phone',
  'home_visit',
  'case_conference',
  'group',
  'incident',
  'physical_health',
  'lai',
  'clozapine',
] as const;

export type AmbientFormat = 'soap' | 'mse' | 'progress' | 'intake' | 'all'
  | 'ward_round' | 'review' | 'collateral' | 'phone' | 'home_visit'
  | 'case_conference' | 'group' | 'incident' | 'physical_health'
  | 'lai' | 'clozapine';

export interface AmbientNoteOptions {
  format?: AmbientFormat;
  model?: string;
  interpreterUsed?: boolean;
  interpreterLanguage?: string;
  patientId?: string;
  consentId?: string;
}

export interface AmbientNoteQueuedJob {
  jobId: string;
  action: 'ambient-audio';
  status: 'queued';
  pollingUrl: string;
  message: string;
}

export interface AmbientAiJobStatus {
  jobId: string;
  action: string;
  patientId?: string | null;
  status: 'queued' | 'waiting' | 'active' | 'processing' | 'transcribing' | 'generating' | 'validating' | 'completed' | 'failed' | string;
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

export interface AmbientAiJobSummary {
  jobId: string;
  action: string;
  patientId?: string | null;
  status: AmbientAiJobStatus['status'];
  submittedAt?: string | Date;
  progress?: number | object | null;
  stage?: string | null;
  statusMessage?: string | null;
  completedAt?: string | Date | null;
  failedAt?: string | Date | null;
}

export class AmbientNoteJobTimeoutError extends Error {
  readonly jobId: string;
  readonly lastStatus?: AmbientAiJobStatus;

  constructor(jobId: string, lastStatus?: AmbientAiJobStatus) {
    super(`Ambient scribe job ${jobId} is still running after the polling window.`);
    this.name = 'AmbientNoteJobTimeoutError';
    this.jobId = jobId;
    this.lastStatus = lastStatus;
    Object.setPrototypeOf(this, AmbientNoteJobTimeoutError.prototype);
  }
}

function normalizeAmbientFormat(format: AmbientNoteOptions['format']): AmbientFormat | undefined {
  if (!format) return undefined;
  return (AMBIENT_NOTE_FORMATS as readonly string[]).includes(format) ? format : 'soap';
}

function sanitizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function normalizeAmbientNoteOptions(options: AmbientNoteOptions): AmbientNoteOptions {
  const normalizedPatientId = sanitizeOptionalText(options.patientId, 64);
  const normalizedConsentId = sanitizeOptionalText(options.consentId, 64);

  if (!normalizedPatientId || !UUIDISH_RE.test(normalizedPatientId)) {
    throw new Error('Ambient recording requires a valid patient context before upload. Please refresh the note and try again.');
  }
  if (!normalizedConsentId || !UUIDISH_RE.test(normalizedConsentId)) {
    throw new Error('Ambient recording consent was missing or expired. Please restart the recording so a fresh consent can be captured.');
  }

  const interpreterUsed = options.interpreterUsed === true;
  return {
    format: normalizeAmbientFormat(options.format),
    model: sanitizeOptionalText(options.model, 128),
    interpreterUsed,
    interpreterLanguage: interpreterUsed
      ? sanitizeOptionalText(options.interpreterLanguage, 64)
      : undefined,
    patientId: normalizedPatientId,
    consentId: normalizedConsentId,
  };
}

function buildAmbientForm(audioBlob: Blob, options: AmbientNoteOptions): FormData {
  const normalizedOptions = normalizeAmbientNoteOptions(options);

  const form = new FormData();
  const ext = audioBlob.type.includes('mp4') ? 'm4a'
    : audioBlob.type.includes('aac') ? 'aac'
    : audioBlob.type.includes('wav') ? 'wav'
    : audioBlob.type.includes('ogg') ? 'ogg'
    : 'webm';
  form.append('audio', audioBlob, `recording.${ext}`);
  if (normalizedOptions.format) form.append('format', normalizedOptions.format);
  if (normalizedOptions.model) form.append('model', normalizedOptions.model);
  if (normalizedOptions.interpreterUsed) form.append('interpreterUsed', 'true');
  if (normalizedOptions.interpreterLanguage) form.append('interpreterLanguage', normalizedOptions.interpreterLanguage);
  form.append('patientId', normalizedOptions.patientId!);
  form.append('consentId', normalizedOptions.consentId!);
  return form;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAmbientNoteResult(value: unknown): value is AmbientNoteResult {
  if (!isObject(value)) return false;
  if (typeof value.transcript !== 'string') return false;
  if (!isObject(value.structured)) return false;
  return typeof value.summary === 'string';
}

export function extractAmbientResultFromJobStatus(status: AmbientAiJobStatus): AmbientNoteResult | null {
  const resultJson = status.resultJson;
  if (!isObject(resultJson)) return null;
  const payload = resultJson.payload;
  return isAmbientNoteResult(payload) ? payload : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const llmAmbientApi = {
  /** Legacy: returns SOAP-only */
  generateAmbientNoteDraft: async (
    audioBlob: Blob,
    opts: Pick<AmbientNoteOptions, 'patientId' | 'consentId'>,
  ): Promise<LLMSoapResponse> => {
    const result = await llmAmbientApi.generateAmbientNote(audioBlob, {
      format: 'soap',
      patientId: opts.patientId,
      consentId: opts.consentId,
    });
    return {
      subjective: result.structured.subjective,
      objective: result.structured.objective,
      assessment: result.structured.assessment,
      plan: result.structured.plan,
      aiGenerated: true as const,
      requiresReview: true as const,
    };
  },

  /** Enhanced: returns full ambient result with MSE, risk flags, diagnosis, interpreter support */
  generateAmbientNote: async (
    audioBlob: Blob,
    opts: AmbientNoteOptions | AmbientFormat = 'soap',
  ): Promise<AmbientNoteResult> => {
    // Support both old signature (string format) and new (options object)
    const options: AmbientNoteOptions = typeof opts === 'string' ? { format: opts } : opts;
    const form = buildAmbientForm(audioBlob, options);

    return apiClient.instance.post<AmbientNoteResult>('llm/ambient-note', form, {
      timeout: AMBIENT_NOTE_HTTP_TIMEOUT_MS,
    }).then((r) => r.data);
  },

  queueAmbientNote: async (
    audioBlob: Blob,
    opts: AmbientNoteOptions,
  ): Promise<AmbientNoteQueuedJob> => {
    const form = buildAmbientForm(audioBlob, opts);
    return apiClient.instance.post<AmbientNoteQueuedJob>('llm/ambient-note/jobs', form, {
      timeout: 60_000,
    }).then((r) => r.data);
  },

  getAiJobStatus: async (jobId: string): Promise<AmbientAiJobStatus> => {
    return apiClient.get<AmbientAiJobStatus>(`ai/jobs/${jobId}`);
  },

  listAiJobs: async (params: { patientId?: string; action?: string } = {}): Promise<AmbientAiJobSummary[]> => {
    const response = await apiClient.get<{ jobs: AmbientAiJobSummary[] }>('ai/jobs', params);
    return response.jobs;
  },

  waitForAmbientNoteJob: async (
    jobId: string,
    opts: {
      intervalMs?: number;
      timeoutMs?: number;
      onProgress?: (status: AmbientAiJobStatus) => void;
    } = {},
  ): Promise<AmbientNoteResult> => {
    const intervalMs = opts.intervalMs ?? AMBIENT_NOTE_JOB_POLL_INTERVAL_MS;
    const timeoutMs = opts.timeoutMs ?? AMBIENT_NOTE_JOB_TIMEOUT_MS;
    const startedAt = Date.now();
    let lastStatus: AmbientAiJobStatus | undefined;

    while (Date.now() - startedAt < timeoutMs) {
      const status = await llmAmbientApi.getAiJobStatus(jobId);
      lastStatus = status;
      opts.onProgress?.(status);

      if (status.status === 'failed') {
        throw new Error(status.failedReason || status.statusMessage || 'Ambient scribe job failed.');
      }
      if (status.status === 'completed') {
        const result = extractAmbientResultFromJobStatus(status);
        if (result) return result;
        throw new Error('Ambient scribe job completed without a structured clinical note payload.');
      }

      await delay(intervalMs);
    }

    throw new AmbientNoteJobTimeoutError(jobId, lastStatus);
  },
};
