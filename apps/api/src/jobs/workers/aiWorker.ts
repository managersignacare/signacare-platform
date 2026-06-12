/**
 * AI Job Worker — Processes LLM requests asynchronously via BullMQ
 *
 * Instead of blocking HTTP requests for 30-180 seconds, AI work is queued
 * and results are delivered via SSE (Server-Sent Events).
 *
 * Job types:
 *   - formulation, isbar, maudsley, admin-report, report-insight
 *   - handover-summary, medication-adherence, ect-summary, linkages, lifechart-schema, discharge
 *   - ambient (textual scribe pass-through and SOAP conversion)
 */

import { Worker, Job, Queue } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../../utils/logger';
// BUG-042 — canonical shutdown registry (static import per §9.6).
import { registerShutdownHook } from '../../shared/gracefulShutdown';
import { AppError, HttpError } from '../../shared/errors';
import { dbAdmin } from '../../db/db';
import type { AuthContext } from '@signacare/shared';
import { requireClinicalAccessRole, requirePatientRelationship } from '../../shared/authGuards';
import { withTenantContext } from '../../shared/tenantContext';
import { updateAiJobRun } from '../../features/llm/aiJobStore';
import type { AmbientOutputFormat, AmbientResult } from '../../mcp/ambientProcessor';
import { isScribeAudioRetention, type ScribeAudioRetention } from '../../mcp/scribeAudioRetention';
import type { BlobBackendName, BlobStorage } from '../../shared/blobStorage';
import { detectScribeHallucinations } from '../../shared/detectScribeHallucinations';
import { writeAuditLog } from '../../utils/audit';
import { normalizeAiJobWarnings, toJsonbDbValue } from '../../features/llm/aiJobJsonb';
import { toClinicianFacingAiJobErrorMessage } from '../../features/llm/aiJobErrorPresentation';
import { buildDurableAiJobResult } from './aiJobResultPersistence';
import {
  getAiJobQueuePriority,
  haveAiJobRetriesExhausted,
  resolveFailedAttemptNumber,
} from './aiJobRetryDiscipline';
const AI_QUEUE_NAME = 'ai-jobs';

interface AiJobData {
  jobId: string;
  action: string;
  data: string;
  model?: string;
  patientId?: string;
  episodeId?: string;
  enhance?: boolean | 'draft';
  templateType?: string;
  staffId?: string;
  clinicId?: string;
}

interface AiJobResult {
  jobId: string;
  action: string;
  result: string;
  payload?: unknown;
  model: string;
  modelVersion?: string | null;
  validated: boolean;
  validationWarnings: string[];
  completedAt: string;
}
interface AmbientAudioJobPayload {
  audioStorageKey: string;
  audioStorageBackend?: BlobBackendName;
  audioStorageBucket?: string;
  mimeType: string;
  patientId: string;
  consentId: string;
  outputFormat?: AmbientOutputFormat;
  interpreterUsed?: boolean;
  interpreterLanguage?: string;
  model?: string;
  audioRetentionPolicy?: ScribeAudioRetention;
}

interface AmbientJobStaffRow {
  id: string;
  clinic_id: string;
  role: string;
  is_active: boolean;
  deleted_at: Date | string | null;
}

interface QueuedAiJobRunRow {
  id: string;
  clinic_id: string;
  staff_id: string;
  patient_id: string | null;
  consent_id: string | null;
  action: string;
  model: string | null;
  queue_payload: unknown;
  audio_storage_key: string | null;
  audio_storage_backend: string | null;
  audio_storage_bucket: string | null;
  audio_mime_type: string | null;
}

function isAmbientAudioJobPayload(value: unknown): value is AmbientAudioJobPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<AmbientAudioJobPayload>;
  return typeof payload.audioStorageKey === 'string'
    && typeof payload.mimeType === 'string'
    && typeof payload.patientId === 'string'
    && typeof payload.consentId === 'string';
}

function isBlobBackendName(value: unknown): value is BlobBackendName {
  return value === 'local' || value === 's3' || value === 'azure-blob';
}

async function resolveAmbientAudioStorage(backend?: string | null): Promise<BlobStorage> {
  const { blobStorage, buildBlobStorageForBackend } = await import('../../shared/blobStorage');
  const recordedBackend = isBlobBackendName(backend) ? backend : blobStorage.backendName;
  return recordedBackend === blobStorage.backendName
    ? blobStorage
    : buildBlobStorageForBackend(recordedBackend);
}

function isAiJobDataPayload(value: unknown): value is AiJobData {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<AiJobData>;
  return typeof payload.jobId === 'string'
    && typeof payload.action === 'string'
    && typeof payload.data === 'string'
    && typeof payload.staffId === 'string'
    && typeof payload.clinicId === 'string';
}

function reconstructAmbientPayload(row: QueuedAiJobRunRow): AmbientAudioJobPayload | null {
  if (isAmbientAudioJobPayload(row.queue_payload)) {
    return {
      ...row.queue_payload,
      audioStorageBackend: row.queue_payload.audioStorageBackend
        ?? (isBlobBackendName(row.audio_storage_backend) ? row.audio_storage_backend : undefined),
      audioStorageBucket: row.queue_payload.audioStorageBucket ?? row.audio_storage_bucket ?? undefined,
    };
  }
  if (!row.audio_storage_key || !row.audio_mime_type || !row.patient_id || !row.consent_id) return null;
  return {
    audioStorageKey: row.audio_storage_key,
    audioStorageBackend: isBlobBackendName(row.audio_storage_backend)
      ? row.audio_storage_backend
      : undefined,
    audioStorageBucket: row.audio_storage_bucket ?? undefined,
    mimeType: row.audio_mime_type,
    patientId: row.patient_id,
    consentId: row.consent_id,
    outputFormat: 'soap',
    model: row.model ?? undefined,
  };
}

function reconstructAiJobData(row: QueuedAiJobRunRow): AiJobData | null {
  if (isAiJobDataPayload(row.queue_payload)) {
    return {
      ...row.queue_payload,
      jobId: row.id,
      action: row.action,
      staffId: row.staff_id,
      clinicId: row.clinic_id,
      patientId: row.patient_id ?? row.queue_payload.patientId,
      episodeId: row.queue_payload.episodeId,
      model: row.model ?? row.queue_payload.model,
    };
  }

  if (row.action !== 'ambient-audio') return null;
  const ambientPayload = reconstructAmbientPayload(row);
  if (!ambientPayload || !row.patient_id) return null;
  return {
    jobId: row.id,
    action: 'ambient-audio',
    data: JSON.stringify(ambientPayload),
    model: row.model ?? undefined,
    patientId: row.patient_id,
    staffId: row.staff_id,
    clinicId: row.clinic_id,
  };
}

async function recoverOrphanedQueuedAiJobs(redisUrl: string): Promise<void> {
  const recoveryConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const recoveryQueue = new Queue<AiJobData>(AI_QUEUE_NAME, { connection: recoveryConnection });
  try {
    const rows = await dbAdmin('ai_job_runs')
      .where({ status: 'queued' })
      .whereNull('deleted_at')
      .orderBy('queued_at', 'asc')
      .limit(50)
      .select<QueuedAiJobRunRow[]>(
        'id',
        'clinic_id',
        'staff_id',
        'patient_id',
        'consent_id',
        'action',
        'model',
        'queue_payload',
        'audio_storage_key',
        'audio_storage_backend',
        'audio_storage_bucket',
        'audio_mime_type',
      );

    let recovered = 0;
    for (const row of rows) {
      const existing = await Job.fromId(recoveryQueue, row.id);
      if (existing) continue;

      const jobData = reconstructAiJobData(row);
      if (!jobData) {
        if (row.action === 'ambient-audio') {
          await cleanupAmbientAudioIfImmediate({
            clinicId: row.clinic_id,
            staffId: row.staff_id,
            jobId: row.id,
            audioStorageKey: row.audio_storage_key,
            audioStorageBackend: row.audio_storage_backend,
            reason: 'failed',
          }).catch((err) => {
            logger.error(
              { err, jobId: row.id, clinicId: row.clinic_id },
              'Async ambient recording cleanup failed during queue recovery failure',
            );
          });
        }
        await updateAiJobRun(row.clinic_id, row.id, {
          status: 'failed',
          progressPercent: 0,
          stage: 'queue_recovery_failed',
          statusMessage: 'Queued AI job could not be recovered because queue context is incomplete',
          errorCode: 'AI_JOB_QUEUE_CONTEXT_INCOMPLETE',
          errorMessage: 'Queued AI job is missing durable queue payload context',
          failedAt: new Date(),
        }, row.staff_id);
        continue;
      }

      await recoveryQueue.add(row.action, jobData, {
        jobId: row.id,
        attempts: row.action === 'ambient-audio' ? 1 : 2,
        backoff: { type: 'exponential', delay: 10_000 },
        priority: getAiJobQueuePriority(row.action),
        removeOnComplete: { age: 14 * 86400 },
        removeOnFail: { age: 30 * 86400 },
      });
      await updateAiJobRun(row.clinic_id, row.id, {
        progressPercent: 0,
        stage: 'queue_recovered',
        statusMessage: 'Queued AI job recovered after queue admission reconciliation',
      }, row.staff_id);
      recovered += 1;
    }
    if (recovered > 0) {
      logger.info({ recovered }, 'Recovered orphaned queued AI jobs');
    }
  } finally {
    await recoveryQueue.close();
    recoveryConnection.disconnect();
  }
}

async function cleanupAmbientAudioIfImmediate(params: {
  clinicId: string;
  staffId: string;
  jobId: string;
  audioStorageKey: string | null | undefined;
  audioStorageBackend?: string | null;
  audioRetentionPolicy?: string | null;
  reason: 'completed' | 'failed' | 'consent_revoked';
}): Promise<void> {
  if (!params.audioStorageKey) return;
  const { getRetentionForClinic } = await import('../../mcp/scribeAudioRetention');
  const retentionPolicy = isScribeAudioRetention(params.audioRetentionPolicy)
    ? params.audioRetentionPolicy
    : await getRetentionForClinic(params.clinicId);

  if (retentionPolicy !== 'immediate_delete') {
    await updateAiJobRun(params.clinicId, params.jobId, {
      audioRetentionPolicy: retentionPolicy,
    }, params.staffId);
    logger.info(
      { jobId: params.jobId, clinicId: params.clinicId, reason: params.reason, retentionPolicy },
      'Async ambient recording audio retained under clinic retention policy',
    );
    return;
  }

  const storage = await resolveAmbientAudioStorage(params.audioStorageBackend);
  await storage.delete(params.audioStorageKey);
  await updateAiJobRun(params.clinicId, params.jobId, {
    audioRetentionPolicy: retentionPolicy,
    audioDeletedAt: new Date(),
  }, params.staffId);
  logger.info(
    { jobId: params.jobId, clinicId: params.clinicId, reason: params.reason, backend: storage.backendName },
    'Async ambient recording audio deleted under immediate retention policy',
  );
}

function aiJobErrorCode(err: unknown): string {
  if (err instanceof HttpError) return err.code;
  return 'AI_JOB_FAILED';
}

async function assertAmbientScribeSafety(params: {
  clinicId: string;
  staffId: string;
  patientId: string;
  result: AmbientResult;
}): Promise<void> {
  const check = detectScribeHallucinations(params.result.transcript ?? '', {
    medications: [
      ...(params.result.medications ?? []).map((med) => ({
        name: med.name ?? '',
        dose: med.dose ?? '',
      })),
      ...(params.result.verifiedMedications ?? []).map((med) => ({
        name: med.name ?? '',
        dose: med.dose ?? '',
      })),
    ],
    diagnoses: (params.result.suggestedDiagnosis ?? []).map((display) => ({
      display,
      code: '',
    })),
    allergies: [],
    noteText: params.result.summary ?? '',
  });

  if (check.ok) return;

  await writeAuditLog({
    clinicId: params.clinicId,
    actorId: params.staffId,
    tableName: 'clinical_notes',
    recordId: '00000000-0000-0000-0000-000000000000',
    action: 'SCRIBE_HALLUCINATION_BLOCKED',
    newData: {
      findings: check.findings,
      patientId: params.patientId,
      async: true,
    },
  });

  throw new AppError(
    'Review required — potential hallucinations detected',
    422,
    'AI_HALLUCINATION_DETECTED',
    { findings: check.findings },
  );
}

/**
 * BUG-331 — ambient jobs can sit in queue while staff relationships change.
 * Re-evaluate the current patient-relationship (and staff eligibility) at
 * pickup-time before any LLM processing starts.
 */
export async function recheckAmbientPatientRelationshipAtPickup(
  job: Pick<AiJobData, 'action' | 'patientId' | 'staffId' | 'clinicId'>,
): Promise<AuthContext | null> {
  if (job.action === 'admin-report' && !job.patientId) return null;
  if (job.action === 'handover-summary' && !job.patientId) {
    if (!job.staffId || !job.clinicId) {
      throw new AppError(
        'Clinical AI jobs require clinic and staff context',
        400,
        'AI_JOB_CONTEXT_INVALID',
      );
    }

    const staff = await dbAdmin('staff')
      .where({ id: job.staffId })
      .whereNull('deleted_at')
      .first<AmbientJobStaffRow>('id', 'clinic_id', 'role', 'is_active', 'deleted_at');

    if (!staff || staff.clinic_id !== job.clinicId || !staff.is_active) {
      throw new AppError(
        'Ambient job staff context is not active for this clinic',
        403,
        'AMBIENT_STAFF_CONTEXT_INVALID',
      );
    }

    return {
      staffId: staff.id,
      clinicId: staff.clinic_id,
      role: staff.role,
      permissions: [],
      patientId: undefined,
    };
  }

  if (!job.patientId || !job.staffId || !job.clinicId) {
    throw new AppError(
      'Clinical AI jobs require patientId, staffId, and clinicId to enforce relationship checks',
      400,
      'AI_JOB_CONTEXT_INVALID',
    );
  }

  const staff = await dbAdmin('staff')
    .where({ id: job.staffId })
    .whereNull('deleted_at')
    .first<AmbientJobStaffRow>('id', 'clinic_id', 'role', 'is_active', 'deleted_at');

  if (!staff || staff.clinic_id !== job.clinicId || !staff.is_active) {
    throw new AppError(
      'Ambient job staff context is not active for this clinic',
      403,
      'AMBIENT_STAFF_CONTEXT_INVALID',
    );
  }

  const auth: AuthContext = {
    staffId: staff.id,
    clinicId: staff.clinic_id,
    role: staff.role,
    permissions: [],
    patientId: job.patientId,
  };

  requireClinicalAccessRole(auth);
  await requirePatientRelationship(auth, job.patientId);
  return auth;
}

// ── Validation rules for AI output ──
function validateAiOutput(action: string, output: string): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Check for empty output
  if (!output || output.trim().length < 10) {
    return { valid: false, warnings: ['Output is empty or too short'] };
  }

  // Check for hallucinated drug names (common LLM issue)
  const suspiciousDrugPatterns = /(\d{4,}\s*mg|\d{3,}\s*mcg|inject\s+\d{3,}\s*ml)/i;
  if (suspiciousDrugPatterns.test(output)) {
    warnings.push('Possible hallucinated drug dose detected — review carefully');
  }

  // Check for PII leakage patterns (other patient names/MRNs appearing in output)
  const mrnPattern = /EMR-\d{3,}/g;
  const mrnMatches = output.match(mrnPattern);
  if (mrnMatches && mrnMatches.length > 1) {
    warnings.push('Multiple MRN references detected — possible cross-patient data leak');
  }

  // Check for markdown artifacts that should have been stripped
  if (/^#{1,3}\s/m.test(output) || /\*\*[^*]+\*\*/g.test(output)) {
    // Strip markdown for clinical output
    warnings.push('Markdown formatting detected and will be stripped');
  }

  // Action-specific validation
  if (action === 'formulation' || action === '5p-formulation') {
    const requiredSections = ['presenting', 'predisposing', 'precipitating', 'perpetuating', 'protective'];
    const missing = requiredSections.filter(s => !output.toLowerCase().includes(s));
    if (missing.length > 2) {
      warnings.push(`Formulation may be incomplete — missing: ${missing.join(', ')}`);
    }
  }

  return { valid: true, warnings };
}

// Strip markdown from clinical output
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*]\s+/gm, '- ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

export function startAiWorker(redisUrl: string) {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  recoverOrphanedQueuedAiJobs(redisUrl).catch((err) => {
    logger.error({ err }, 'Failed to reconcile orphaned queued AI jobs');
  });

  const publishProgress = async (
    clinicId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    if (!clinicId) return;
    await connection.publish(`ai-events:${clinicId}`, JSON.stringify(payload));
  };

  const worker = new Worker<AiJobData, AiJobResult>(
    AI_QUEUE_NAME,
    async (job: Job<AiJobData>) => {
      const { jobId, action, data, model, staffId, clinicId, enhance, templateType, episodeId } = job.data;
      const startTime = Date.now();
      let ambientAudioStorageKeyForCleanup: string | null = null;
      let ambientAudioStorageBackendForCleanup: string | null = null;
      let ambientCleanupReason: 'failed' | 'consent_revoked' = 'failed';
      let ambientPayload: AmbientAudioJobPayload | null = null;

      if (!clinicId || !staffId) {
        throw new AppError('AI jobs require clinicId and staffId', 400, 'AI_JOB_CONTEXT_INVALID');
      }

      logger.info({ jobId, action, staffId }, `AI job started: ${action}`);

      await updateAiJobRun(clinicId, jobId, {
        status: 'processing',
        progressPercent: 5,
        stage: 'worker_started',
        statusMessage: 'AI worker picked up the job',
        startedAt: new Date(startTime),
      }, staffId).catch((err) => {
        logger.warn({ err, jobId, clinicId }, 'Failed to persist AI job start state');
      });

      await publishProgress(clinicId, {
        type: 'ai-job-progress',
        jobId,
        action,
        status: 'processing',
        progress: 5,
        stage: 'worker_started',
        message: 'AI worker picked up the job',
        staffId,
      });

      try {
        if (action === 'ambient-audio') {
          ambientPayload = JSON.parse(data) as AmbientAudioJobPayload;
          if (!ambientPayload.audioStorageKey || !ambientPayload.patientId || !ambientPayload.consentId) {
            throw new AppError('Ambient audio jobs require audioStorageKey, patientId, and consentId', 400, 'AMBIENT_AUDIO_JOB_INVALID');
          }
          ambientAudioStorageKeyForCleanup = ambientPayload.audioStorageKey;
          ambientAudioStorageBackendForCleanup = ambientPayload.audioStorageBackend ?? null;
        }

        const jobAuth = await recheckAmbientPatientRelationshipAtPickup(job.data);

        await updateAiJobRun(clinicId, jobId, {
          status: 'processing',
          progressPercent: 15,
          stage: 'clinical_access_rechecked',
          statusMessage: 'Clinical access and patient relationship rechecked',
        }, staffId).catch((err) => {
          logger.warn({ err, jobId, clinicId }, 'Failed to persist AI job access-check state');
        });
        await publishProgress(clinicId, {
          type: 'ai-job-progress',
          jobId,
          action,
          status: 'processing',
          progress: 15,
          stage: 'clinical_access_rechecked',
          message: 'Clinical access and patient relationship rechecked',
          staffId,
        });

        let result = '';
        let payload: unknown;
        let executionModelName = model ?? 'default';
        let executionModelVersion: string | null = null;
        const runRoutedAction = async (
          routedAction: 'maudsley' | 'isbar' | 'formulation' | '5p-formulation' | '91day' | 'letter'
            | 'ambient' | 'admin-report' | 'discharge' | 'med-summary' | 'register-summary' | 'risk-summary'
            | 'report-insight' | 'handover-summary' | 'medication-adherence' | 'ect-summary' | 'mhrt-report'
            | 'certificate' | 'classify' | 'linkages' | 'lifechart-schema',
        ): Promise<string> => {
          const { generateClinicalAction } = await import('../../features/llm/modelRouter/modelRouter');
          const effectiveTemplateType = templateType ?? (routedAction === 'letter' ? 'GP letter' : undefined);
          const routed = await generateClinicalAction({
            clinicId,
            action: routedAction,
            data,
            templateType: effectiveTemplateType,
            requestedModel: model,
          });
          executionModelName = routed.execution.modelName;
          executionModelVersion = routed.execution.modelVersion;
          return routed.text;
        };
        const runEnhancedAction = async (
          enhancedAction: 'maudsley' | 'isbar' | 'formulation' | '5p-formulation' | '91day' | 'letter' | 'discharge' | 'med-summary',
        ): Promise<void> => {
          if (!jobAuth || !job.data.patientId) {
            throw new AppError(
              'Enhanced AI jobs require patient relationship context',
              400,
              'AI_JOB_CONTEXT_INVALID',
            );
          }
          const { enhancedGenerate } = await import('../../mcp/aiEnhancer');
          const output = await enhancedGenerate({
            action: enhancedAction,
            data,
            patientId: job.data.patientId,
            episodeId,
            auth: jobAuth,
            model,
            refine: enhance !== 'draft',
          });
          result = output.result;
          payload = {
            enriched: output.enriched,
            sections: output.sections,
            model: output.model,
          };
          executionModelName = output.model;
        };
        if (action !== 'ambient-audio') {
          await updateAiJobRun(clinicId, jobId, {
            status: 'generating',
            progressPercent: 35,
            stage: 'llm_generation_started',
            statusMessage: 'Generating AI output',
          }, staffId).catch((err) => {
            logger.warn({ err, jobId, clinicId }, 'Failed to persist AI job generation-start state');
          });
          await publishProgress(clinicId, {
            type: 'ai-job-progress',
            jobId,
            action,
            status: 'generating',
            progress: 35,
            stage: 'llm_generation_started',
            message: 'Generating AI output',
            staffId,
          });
        }

        switch (action) {
          case 'maudsley':
          case 'formulation':
          case 'isbar':
          case '5p-formulation':
          case '91day':
          case 'letter':
          case 'discharge':
          case 'med-summary': {
            if (jobAuth && job.data.patientId && enhance !== false) {
              await runEnhancedAction(action);
              break;
            }
            result = await runRoutedAction(action);
            break;
          }
          case 'ambient': {
            result = await runRoutedAction(action);
            break;
          }
          case 'report-insight':
          case 'handover-summary':
          case 'register-summary':
          case 'risk-summary':
          case 'medication-adherence':
          case 'ect-summary':
          case 'mhrt-report':
          case 'certificate':
          case 'classify':
          case 'linkages':
          case 'lifechart-schema':
          case 'admin-report': {
            result = await runRoutedAction(action);
            break;
          }
          case 'ambient-audio': {
            const parsed = ambientPayload;
            if (!parsed) {
              throw new AppError('Ambient audio job payload was not prepared for processing', 400, 'AMBIENT_AUDIO_JOB_INVALID');
            }
            const { verifyRecordingConsentStillActive } = await import('../../shared/recordingConsent');
            const { processAmbientAudio } = await import('../../mcp/ambientProcessor');

            try {
              await verifyRecordingConsentStillActive(clinicId, parsed.patientId, parsed.consentId);
            } catch (err) {
              ambientCleanupReason = 'consent_revoked';
              throw err;
            }
            await updateAiJobRun(clinicId, jobId, {
              status: 'transcribing',
              progressPercent: 25,
              stage: 'audio_loaded',
              statusMessage: 'Loading recording for transcription',
            }, staffId);
            await publishProgress(clinicId, {
              type: 'ai-job-progress',
              jobId,
              action,
              status: 'transcribing',
              progress: 25,
              stage: 'audio_loaded',
              message: 'Loading recording for transcription',
              staffId,
            });

            const audioStorage = await resolveAmbientAudioStorage(parsed.audioStorageBackend);
            const audioBuffer = await audioStorage.getBuffer(parsed.audioStorageKey);
            if (!audioBuffer || audioBuffer.length === 0) {
              throw new AppError('Queued ambient recording could not be loaded', 404, 'AMBIENT_AUDIO_BLOB_MISSING');
            }

            await updateAiJobRun(clinicId, jobId, {
              status: 'transcribing',
              progressPercent: 45,
              stage: 'transcription_started',
              statusMessage: 'Transcribing psychiatric interview recording',
            }, staffId);
            await publishProgress(clinicId, {
              type: 'ai-job-progress',
              jobId,
              action,
              status: 'transcribing',
              progress: 45,
              stage: 'transcription_started',
              message: 'Transcribing psychiatric interview recording',
              staffId,
            });

            const ambientResult = await processAmbientAudio(audioBuffer, parsed.mimeType, {
              clinicId,
              staffId,
              patientId: parsed.patientId,
              auth: jobAuth ?? undefined,
              consentId: parsed.consentId,
              model: parsed.model ?? model,
              outputFormat: parsed.outputFormat ?? 'soap',
              interpreterUsed: parsed.interpreterUsed === true,
              interpreterLanguage: parsed.interpreterLanguage,
            });
            try {
              await verifyRecordingConsentStillActive(clinicId, parsed.patientId, parsed.consentId);
            } catch (err) {
              ambientCleanupReason = 'consent_revoked';
              throw err;
            }
            await assertAmbientScribeSafety({
              clinicId,
              staffId,
              patientId: parsed.patientId,
              result: ambientResult,
            });
            payload = ambientResult;
            result = ambientResult.summary || ambientResult.transcript || 'Ambient recording processed; review structured result payload.';
            break;
          }
          default:
            throw new AppError(`Unsupported AI job action: ${action}`, 422, 'AI_JOB_ACTION_UNSUPPORTED');
        }

        // Validate output
        await updateAiJobRun(clinicId, jobId, {
          status: 'validating',
          progressPercent: 80,
          stage: 'clinical_validation_started',
          statusMessage: 'Validating AI output',
        }, staffId).catch((err) => {
          logger.warn({ err, jobId, clinicId }, 'Failed to persist AI job validation state');
        });
        const validation = validateAiOutput(action, result);
        const cleanResult = stripMarkdown(result);
        if (!validation.valid) {
          throw new AppError(
            `AI output failed validation: ${validation.warnings.join('; ') || 'empty output'}`,
            422,
            'AI_OUTPUT_VALIDATION_FAILED',
            { validationWarnings: validation.warnings },
          );
        }

        const jobResult: AiJobResult = {
          jobId,
          action,
          result: cleanResult,
          payload,
          model: executionModelName,
          modelVersion: executionModelVersion,
          validated: validation.valid,
          validationWarnings: validation.warnings,
          completedAt: new Date().toISOString(),
        };
        const durableJobResult = buildDurableAiJobResult(jobResult);

        const durationMs = Date.now() - startTime;
        logger.info({ jobId, action, durationMs, warnings: validation.warnings.length }, `AI job completed: ${action}`);
        try {
          await updateAiJobRun(clinicId, jobId, {
            status: 'completed',
            progressPercent: 100,
            stage: 'completed',
            statusMessage: 'AI output ready for clinician review',
            resultText: cleanResult,
            resultJson: durableJobResult,
            validationValid: validation.valid,
            validationWarnings: durableJobResult.validationWarnings,
            model: durableJobResult.model,
            durationMs,
            completedAt: new Date(durableJobResult.completedAt),
            failedAt: null,
            errorCode: null,
            errorMessage: null,
          }, staffId);
        } catch (persistErr) {
          logger.error(
            { err: persistErr, jobId, action, clinicId },
            'AI job completed but durable result persistence failed',
          );
          await updateAiJobRun(clinicId, jobId, {
            status: 'completed',
            progressPercent: 100,
            stage: 'completed',
            statusMessage: 'AI output ready for clinician review',
            resultText: cleanResult,
            resultJson: {
              ...durableJobResult,
              payload: null,
              persistenceWarning: 'Result payload was reduced for durable storage after a persistence error.',
            },
            validationValid: validation.valid,
            validationWarnings: durableJobResult.validationWarnings,
            model: durableJobResult.model,
            durationMs,
            completedAt: new Date(durableJobResult.completedAt),
            failedAt: null,
            errorCode: 'AI_JOB_RESULT_PERSISTENCE_FAILED',
            errorMessage: 'AI output was generated but durable storage required a reduced metadata payload.',
          }, staffId);
        }

        if (action === 'ambient-audio') {
          await cleanupAmbientAudioIfImmediate({
            clinicId,
            staffId,
            jobId,
            audioStorageKey: ambientAudioStorageKeyForCleanup,
            audioStorageBackend: ambientAudioStorageBackendForCleanup,
            audioRetentionPolicy: ambientPayload?.audioRetentionPolicy,
            reason: 'completed',
          });
        }

        // Record AI provenance for regulatory compliance
        try {
          const crypto = await import('crypto');
          const knex = (await import('../../db/db')).db;
          await withTenantContext(clinicId, async () => {
            await knex('ai_provenance').insert({
              id: crypto.randomUUID(),
              clinic_id: clinicId,
              job_id: jobId,
              action,
              output_hash: crypto.createHash('sha256').update(cleanResult).digest('hex'),
              output_length: cleanResult.length,
              model_name: jobResult.model,
              model_version: durableJobResult.modelVersion
                ?? process.env.OLLAMA_MODEL_VERSION
                ?? process.env.OLLAMA_MODEL_MANIFEST_SHA256 ?? 'unknown',
              prompt_template_version: '1.0',
              patient_id: job.data.patientId || null,
              source_data_summary: data.substring(0, 500),
              validated: validation.valid,
              validation_warnings: toJsonbDbValue(knex, normalizeAiJobWarnings(validation.warnings), []),
              created_by_staff_id: staffId,
              created_at: new Date(),
            });
          }, staffId).catch((err) => { logger.warn({ err, jobId: job.id, clinicId }, 'Non-blocking: AI provenance write failed'); });
        } catch (provenanceErr) { logger.warn({ err: provenanceErr, jobId: job.id, clinicId }, 'Non-blocking: AI provenance try/catch failed'); }

        // Publish completion event
        await publishProgress(clinicId, {
          type: 'ai-job-complete',
          ...durableJobResult,
          staffId,
          durationMs,
          progress: 100,
          stage: 'completed',
        });

        return jobResult;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errorCode = aiJobErrorCode(err);
        const clinicianErrorMessage = toClinicianFacingAiJobErrorMessage({
          errorCode,
          errorMessage: errMsg,
        }) ?? 'AI job failed';
        const maxAttempts = job.opts.attempts ?? 1;
        const failedAttemptNumber = resolveFailedAttemptNumber(job.attemptsMade);
        const retriesExhausted = haveAiJobRetriesExhausted({
          attemptsMade: job.attemptsMade,
          maxAttempts,
        });
        logger.error(
          { jobId, action, attempt: failedAttemptNumber, maxAttempts, retriesExhausted, err },
          `AI job failed: ${action}`,
        );

        if (!retriesExhausted) {
          await updateAiJobRun(clinicId, jobId, {
            status: 'retrying',
            progressPercent: 5,
            stage: 'retrying',
            statusMessage: `AI job attempt ${failedAttemptNumber} failed; retrying`,
            errorCode,
            errorMessage: errMsg,
            durationMs: Date.now() - startTime,
          }, staffId).catch((persistErr) => {
            logger.warn({ err: persistErr, jobId, clinicId }, 'Failed to persist AI job retrying state');
          });
          await publishProgress(clinicId, {
            type: 'ai-job-progress',
            jobId,
            action,
            status: 'retrying',
            error: clinicianErrorMessage,
            errorCode,
            progress: 5,
            stage: 'retrying',
            staffId,
          });
          throw err;
        }

        if (action === 'ambient-audio' && ambientAudioStorageKeyForCleanup) {
          try {
            await cleanupAmbientAudioIfImmediate({
              clinicId,
              staffId,
              jobId,
              audioStorageKey: ambientAudioStorageKeyForCleanup,
              audioStorageBackend: ambientAudioStorageBackendForCleanup,
              audioRetentionPolicy: ambientPayload?.audioRetentionPolicy,
              reason: ambientCleanupReason,
            });
          } catch (cleanupErr) {
            logger.error(
              { err: cleanupErr, jobId, clinicId },
              'Async ambient recording cleanup failed after AI job failure',
            );
          }
        }
        await updateAiJobRun(clinicId, jobId, {
          status: 'failed',
          progressPercent: 100,
          stage: 'failed',
          statusMessage: 'AI job failed',
          errorCode,
          errorMessage: errMsg,
          failedAt: new Date(),
          durationMs: Date.now() - startTime,
        }, staffId).catch((persistErr) => {
          logger.warn({ err: persistErr, jobId, clinicId }, 'Failed to persist AI job failure state');
        });

        // Publish failure event
        await publishProgress(clinicId, {
          type: 'ai-job-failed',
          jobId,
          action,
          error: clinicianErrorMessage,
          errorCode,
          progress: 100,
          stage: 'failed',
          staffId,
        });

        throw err;
      }
    },
    {
      connection,
      concurrency: 2, // Process max 2 AI jobs simultaneously
      limiter: { max: 10, duration: 60_000 }, // Max 10 jobs per minute
    }
  );

  worker.on('error', (err) => {
    logger.error({ err }, 'AI worker error');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err, queue: AI_QUEUE_NAME, data: job?.data },
      'AI worker job failed',
    );
  });

  // BUG-042 — drain in-flight AI jobs before DB close. LLM generation
  // can take 30-180s; 20s is a cap within the 25s overall budget. A
  // job still running at the 20s mark is abandoned (re-queued for the
  // next pod). This is the least-bad option; extending budget past
  // 25s risks k8s SIGKILL before shutdown completes.
  registerShutdownHook({
    name: `bullmq-worker:${AI_QUEUE_NAME}`,
    priority: 60,
    timeoutMs: 20_000,
    handler: async () => { await worker.close(); },
  });

  logger.info('AI job worker started (concurrency: 2)');
  return worker;
}

export { AI_QUEUE_NAME };
export type { AiJobData, AiJobResult };
