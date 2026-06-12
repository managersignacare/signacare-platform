import { createHash } from 'node:crypto';
import { db } from '../../db/db';
import { withTenantContext } from '../../shared/tenantContext';
import { normalizeAiJobResultJson, normalizeAiJobWarnings, toJsonbDbValue } from './aiJobJsonb';

export type AiJobRunStatus =
  | 'queued'
  | 'retrying'
  | 'processing'
  | 'transcribing'
  | 'generating'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AiJobRunRecord {
  id: string;
  clinic_id: string;
  staff_id: string;
  patient_id: string | null;
  consent_id: string | null;
  action: string;
  status: AiJobRunStatus;
  progress_percent: number;
  stage: string | null;
  status_message: string | null;
  model: string | null;
  input_summary: string | null;
  queue_payload: unknown;
  result_text: string | null;
  result_json: unknown;
  output_hash: string | null;
  validation_valid: boolean | null;
  error_code: string | null;
  error_message: string | null;
  validation_warnings: unknown;
  audio_storage_key: string | null;
  audio_storage_backend: string | null;
  audio_storage_bucket: string | null;
  audio_mime_type: string | null;
  audio_retention_policy: string | null;
  audio_deleted_at: Date | string | null;
  duration_ms: number | null;
  queued_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CreateAiJobRunInput {
  jobId: string;
  clinicId: string;
  staffId: string;
  patientId?: string | null;
  consentId?: string | null;
  action: string;
  model?: string | null;
  inputSummary?: string | null;
  queuePayload?: unknown;
  audioStorageKey?: string | null;
  audioStorageBackend?: string | null;
  audioStorageBucket?: string | null;
  audioMimeType?: string | null;
  audioRetentionPolicy?: string | null;
}

interface UpdateAiJobRunInput {
  status?: AiJobRunStatus;
  progressPercent?: number;
  stage?: string | null;
  statusMessage?: string | null;
  model?: string | null;
  startedAt?: Date;
  completedAt?: Date | null;
  failedAt?: Date | null;
  durationMs?: number | null;
  resultText?: string | null;
  resultJson?: unknown;
  validationValid?: boolean | null;
  validationWarnings?: string[];
  errorCode?: string | null;
  errorMessage?: string | null;
  audioRetentionPolicy?: string | null;
  audioDeletedAt?: Date | null;
}

interface ListAiJobRunsOptions {
  patientId?: string;
  action?: string;
}

export function summarizeAiJobInput(data: string, maxLength = 500): string {
  const singleLine = data.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 1)}…` : singleLine;
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function outputHash(text: string | null | undefined): string | null {
  if (!text) return null;
  return createHash('sha256').update(text).digest('hex');
}

export async function createAiJobRun(input: CreateAiJobRunInput): Promise<void> {
  await withTenantContext(input.clinicId, async () => {
    await db('ai_job_runs').insert({
      id: input.jobId,
      clinic_id: input.clinicId,
      staff_id: input.staffId,
      patient_id: input.patientId ?? null,
      consent_id: input.consentId ?? null,
      action: input.action,
      status: 'queued',
      progress_percent: 0,
      stage: 'queued',
      status_message: 'Queued for AI processing',
      model: input.model ?? null,
      input_summary: input.inputSummary ?? null,
      queue_payload: toJsonbDbValue(db, input.queuePayload, {}),
      audio_storage_key: input.audioStorageKey ?? null,
      audio_storage_backend: input.audioStorageBackend ?? null,
      audio_storage_bucket: input.audioStorageBucket ?? null,
      audio_mime_type: input.audioMimeType ?? null,
      audio_retention_policy: input.audioRetentionPolicy ?? null,
    });
  }, input.staffId);
}

export async function updateAiJobRun(
  clinicId: string,
  jobId: string,
  patch: UpdateAiJobRunInput,
  staffId?: string | null,
): Promise<void> {
  await withTenantContext(clinicId, async () => {
    const updates: Record<string, unknown> = {};
    if (patch.status) updates.status = patch.status;
    if (patch.progressPercent !== undefined) updates.progress_percent = clampProgress(patch.progressPercent);
    if (patch.stage !== undefined) updates.stage = patch.stage;
    if (patch.statusMessage !== undefined) updates.status_message = patch.statusMessage;
    if (patch.model !== undefined) updates.model = patch.model;
    if (patch.startedAt) updates.started_at = patch.startedAt;
    if (patch.completedAt !== undefined) updates.completed_at = patch.completedAt;
    if (patch.failedAt !== undefined) updates.failed_at = patch.failedAt;
    if (patch.durationMs !== undefined) updates.duration_ms = patch.durationMs;
    if (patch.resultText !== undefined) {
      updates.result_text = patch.resultText;
      updates.output_hash = outputHash(patch.resultText);
    }
    if (patch.resultJson !== undefined) {
      updates.result_json = toJsonbDbValue(db, normalizeAiJobResultJson(patch.resultJson), {});
    }
    if (patch.validationValid !== undefined) updates.validation_valid = patch.validationValid;
    if (patch.validationWarnings !== undefined) {
      updates.validation_warnings = toJsonbDbValue(db, normalizeAiJobWarnings(patch.validationWarnings), []);
    }
    if (patch.errorCode !== undefined) updates.error_code = patch.errorCode;
    if (patch.errorMessage !== undefined) updates.error_message = patch.errorMessage;
    if (patch.audioRetentionPolicy !== undefined) updates.audio_retention_policy = patch.audioRetentionPolicy;
    if (patch.audioDeletedAt !== undefined) updates.audio_deleted_at = patch.audioDeletedAt;

    if (Object.keys(updates).length === 0) return;
    await db('ai_job_runs')
      .where({ id: jobId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update(updates);
  }, staffId ?? undefined);
}

export async function getAiJobRunForStaff(
  clinicId: string,
  staffId: string,
  jobId: string,
): Promise<AiJobRunRecord | undefined> {
  return withTenantContext(clinicId, async () => {
    return db('ai_job_runs')
      .where({ id: jobId, clinic_id: clinicId, staff_id: staffId })
      .whereNull('deleted_at')
      .first<AiJobRunRecord>();
  }, staffId);
}

export async function listAiJobRunsForStaff(
  clinicId: string,
  staffId: string,
  limit = 20,
  options: ListAiJobRunsOptions = {},
): Promise<AiJobRunRecord[]> {
  return withTenantContext(clinicId, async () => {
    const query = db('ai_job_runs')
      .where({ clinic_id: clinicId, staff_id: staffId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .limit(limit);
    if (options.patientId) {
      query.where({ patient_id: options.patientId });
    }
    if (options.action) {
      query.where({ action: options.action });
    }
    return query.select<AiJobRunRecord[]>('*');
  }, staffId);
}
