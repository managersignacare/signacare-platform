/**
 * Async AI job queue.
 *
 * AI Job Routes — Async AI processing via BullMQ
 *
 * POST /api/v1/ai/jobs       — Submit an AI job (returns jobId immediately)
 * GET  /api/v1/ai/jobs/:id   — Poll job status (fallback if SSE unavailable)
 * GET  /api/v1/ai/jobs       — List recent jobs for current user
 *
 * Results are pushed via SSE in real-time. Polling is only needed as fallback.
 *
 * Long-running clinical AI work must not rely on one browser-held HTTP
 * request. Short synchronous prompts can still use /llm/clinical-ai, but
 * ambient scribe and other long jobs submit work here, persist durable
 * ai_job_runs state, then deliver progress over SSE and polling.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DurableClinicalAiJobActionSchema } from '@signacare/shared';
import { AppError, HttpError } from '../../shared/errors';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { assertModuleRead, requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { AI_QUEUE_NAME } from '../../jobs/workers/aiWorker';
import type { AiJobData } from '../../jobs/workers/aiWorker';
import { getAiJobQueuePriority } from '../../jobs/workers/aiJobRetryDiscipline';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { db } from '../../db/db';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import { verifyRecordingConsentStillActive } from '../../shared/recordingConsent';
import { authorizeAiRequest } from '../ai/policy/aiPolicy';
import {
  type AiJobRunRecord,
  createAiJobRun,
  getAiJobRunForStaff,
  listAiJobRunsForStaff,
  summarizeAiJobInput,
  updateAiJobRun,
} from './aiJobStore';
import { isAiJobStoreUnavailableError, toAiJobQueueSubmitError } from './aiJobRouteSupport';
import { toClinicianFacingAiJobErrorMessage } from './aiJobErrorPresentation';

const AsyncAiActionSchema = DurableClinicalAiJobActionSchema;

const AiJobSubmitSchema = z.object({
  action: AsyncAiActionSchema,
  data: z.union([z.string().min(1), z.record(z.string(), z.unknown())]),
  model: z.string().max(200).optional(),
  patientId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  enhance: z.union([z.boolean(), z.literal('draft')]).optional(),
  templateType: z.string().max(200).optional(),
});

const NullableTimestampSchema = z.union([z.string(), z.date()]).nullable().optional();
const AiJobSubmitResponseSchema = z.object({
  jobId: z.string().min(1),
  action: z.string().min(1),
  status: z.literal('queued'),
  message: z.string().min(1),
});
const AiJobStatusResponseSchema = z.object({
  jobId: z.string().min(1).optional(),
  action: z.string().min(1),
  status: z.string().min(1),
  result: z.string().nullable().optional(),
  resultJson: z.unknown().optional(),
  validated: z.boolean().optional(),
  validationWarnings: z.unknown().optional(),
  completedAt: NullableTimestampSchema,
  failedReason: z.string().nullable().optional(),
  progress: z.unknown().optional(),
  stage: z.string().nullable().optional(),
  statusMessage: z.string().nullable().optional(),
  queuedAt: NullableTimestampSchema,
  startedAt: NullableTimestampSchema,
  failedAt: NullableTimestampSchema,
  durationMs: z.number().nullable().optional(),
  patientId: z.string().uuid().nullable().optional(),
});
const AiJobListResponseSchema = z.object({
  jobs: z.array(z.object({
    jobId: z.string().min(1).optional(),
    action: z.string().min(1),
    patientId: z.string().uuid().nullable().optional(),
    status: z.string().min(1),
    submittedAt: z.union([z.string(), z.date()]).optional(),
    progress: z.unknown().optional(),
    stage: z.string().nullable().optional(),
    statusMessage: z.string().nullable().optional(),
    completedAt: NullableTimestampSchema,
    failedAt: NullableTimestampSchema,
  })),
});
const AiJobListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  action: z.enum(['ambient-audio', ...AsyncAiActionSchema.options]).optional(),
});

const router = Router();
router.use(authMiddleware);
router.use(requireRoles(['clinician', 'admin', 'superadmin']));

// Queue instance for submitting jobs
const connection = new IORedis(config.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const aiQueue = new Queue<AiJobData>(AI_QUEUE_NAME, { connection });

function moduleForAiJobAction(action: string): string {
  return action === 'ambient-audio' ? MODULE_KEYS.MEDICAL_SCRIBE : MODULE_KEYS.AI;
}

async function assertAiJobModuleRead(req: Request, action: string): Promise<void> {
  await assertModuleRead(req, moduleForAiJobAction(action));
}

async function assertAiJobReadAccess(req: Request, record: Pick<AiJobRunRecord, 'patient_id' | 'consent_id' | 'action'>): Promise<void> {
  await assertAiJobModuleRead(req, record.action);
  if (!record.patient_id) {
    if (record.action === 'admin-report') return;
    throw new AppError('AI job is missing required patient context', 403, 'AI_JOB_PATIENT_CONTEXT_REQUIRED');
  }
  const auth = buildAuthContext(req, record.patient_id);
  await requirePatientRelationship(auth, record.patient_id);
  if (record.action === 'ambient-audio') {
    if (!record.consent_id) {
      throw new AppError('Ambient AI job is missing required recording consent context', 403, 'AI_JOB_CONSENT_CONTEXT_REQUIRED');
    }
    await verifyRecordingConsentStillActive(req.clinicId!, record.patient_id, record.consent_id);
  }
}

async function assertEpisodeBelongsToPatient(req: Request, episodeId: string, patientId?: string): Promise<void> {
  if (!patientId) {
    throw new AppError('episodeId requires patientId for AI jobs', 422, 'AI_JOB_EPISODE_PATIENT_REQUIRED');
  }

  const episode = await db('episodes')
    .where({ id: episodeId, clinic_id: req.clinicId!, patient_id: patientId })
    .whereNull('deleted_at')
    .first('id');

  if (!episode) {
    throw new AppError('Episode is not available for this patient', 404, 'AI_JOB_EPISODE_NOT_FOUND');
  }
}

// ── Submit AI Job ──
router.post(
  '/jobs',
  requireModuleRead(MODULE_KEYS.AI),
  authorizeAiRequest({
    routeId: 'clinical-ai',
    allowedPurposes: ['clinical', 'operational'],
  }),
  async (req: Request, res: Response, next: NextFunction) => {
  let parsed: z.infer<typeof AiJobSubmitSchema>;
  try {
    parsed = AiJobSubmitSchema.parse(req.body);
  } catch (err) {
    next(err);
    return;
  }
  const { action, data, model, patientId, episodeId, enhance, templateType } = parsed;

  if (action !== 'admin-report' && !patientId) {
    next(new AppError(`${action} jobs require patientId`, 422, 'VALIDATION_ERROR'));
    return;
  }

  try {
    if (patientId) {
      const auth = buildAuthContext(req, patientId);
      await requirePatientRelationship(auth, patientId);
    }
    if (episodeId) {
      await assertEpisodeBelongsToPatient(req, episodeId, patientId);
    }
  } catch (err) {
    next(err);
    return;
  }

  const jobId = randomUUID();
  const jobData: AiJobData = {
    jobId,
    action,
    data: typeof data === 'string' ? data : JSON.stringify(data),
    model,
    patientId,
    episodeId,
    enhance,
    templateType,
    staffId: req.user!.id,
    clinicId: req.clinicId,
  };

  try {
    await createAiJobRun({
      jobId,
      clinicId: req.clinicId!,
      staffId: req.user!.id,
      patientId: patientId ?? null,
      action,
      model: model ?? null,
      inputSummary: summarizeAiJobInput(jobData.data),
      queuePayload: jobData,
    });

    await aiQueue.add(action, jobData, {
      jobId,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      priority: getAiJobQueuePriority(action),
      removeOnComplete: { age: 7 * 86400 },
      removeOnFail: { age: 14 * 86400 },
    });

    logger.info({ jobId, action, staffId: req.user!.id }, 'AI job submitted');

    res.status(202).json(AiJobSubmitResponseSchema.parse({
      jobId,
      action,
      status: 'queued',
      message: 'Job submitted. Results will be delivered via SSE or poll GET /ai/jobs/:id',
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const submitError = toAiJobQueueSubmitError(err);
    logger.error({ err, message, action }, 'Failed to submit AI job');
    await updateAiJobRun(req.clinicId!, jobId, {
      status: 'failed',
      progressPercent: 0,
      stage: 'queue_submit_failed',
      statusMessage:
        submitError.code === 'AI_JOB_QUEUE_UNAVAILABLE'
          ? 'Background AI queue unavailable'
          : 'Failed to submit AI job to queue',
      errorCode: submitError.code,
      errorMessage: message,
      failedAt: new Date(),
    }, req.user!.id).catch((updateErr) => {
      logger.warn({ err: updateErr, jobId }, 'Failed to mark AI job as queue-submit failed');
    });
    next(submitError);
  }
});

// ── Get Job Status ──
router.get('/jobs/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const persisted = await getAiJobRunForStaff(req.clinicId!, req.user!.id, req.params.id);
    if (persisted) {
      await assertAiJobReadAccess(req, persisted);
      res.json(AiJobStatusResponseSchema.parse({
        jobId: persisted.id,
        action: persisted.action,
        status: persisted.status,
        patientId: persisted.patient_id,
        result: persisted.status === 'completed' ? persisted.result_text : undefined,
        resultJson: persisted.status === 'completed' ? persisted.result_json : undefined,
        validated: persisted.status === 'completed' ? persisted.validation_valid ?? undefined : undefined,
        validationWarnings: persisted.validation_warnings,
        completedAt: persisted.completed_at,
        failedReason: persisted.status === 'failed'
          ? toClinicianFacingAiJobErrorMessage({
            errorCode: persisted.error_code,
            errorMessage: persisted.error_message,
          })
          : undefined,
        progress: persisted.progress_percent,
        stage: persisted.stage,
        statusMessage: persisted.status_message,
        queuedAt: persisted.queued_at,
        startedAt: persisted.started_at,
        failedAt: persisted.failed_at,
        durationMs: persisted.duration_ms,
      }));
      return;
    }

    next(new AppError('Job not found', 404, 'AI_JOB_NOT_FOUND'));
  } catch (err) {
    if (err instanceof AppError || err instanceof HttpError) {
      next(err);
      return;
    }
    logger.warn({ err, jobId: req.params.id }, 'Failed to load AI job status');
    next(new AppError('Job not found', 404, 'AI_JOB_NOT_FOUND'));
  }
});

// ── List Recent Jobs ──
router.get('/jobs', async (req: Request, res: Response, next: NextFunction) => {
  let query: z.infer<typeof AiJobListQuerySchema>;
  try {
    query = AiJobListQuerySchema.parse(req.query);
  } catch (err) {
    next(err);
    return;
  }

  try {
    if (!query.action) {
      next(new AppError('AI job list requires an explicit action scope', 422, 'AI_JOB_LIST_SCOPE_REQUIRED'));
      return;
    }
    if (query.action !== 'admin-report' && !query.patientId) {
      next(new AppError('Clinical AI job list requires patientId', 422, 'AI_JOB_LIST_PATIENT_REQUIRED'));
      return;
    }

    const actionModule = moduleForAiJobAction(query.action);
    await assertModuleRead(req, actionModule);
    if (query.patientId) {
      const auth = buildAuthContext(req, query.patientId);
      await requirePatientRelationship(auth, query.patientId);
    }

    const persisted = await listAiJobRunsForStaff(req.clinicId!, req.user!.id, 25, {
      patientId: query.patientId,
      action: query.action,
    });
    if (persisted.length > 0) {
      res.json(AiJobListResponseSchema.parse({
        jobs: persisted.map((job) => ({
          jobId: job.id,
          action: job.action,
          patientId: job.patient_id,
          status: job.status,
          submittedAt: job.queued_at,
          progress: job.progress_percent,
          stage: job.stage,
          statusMessage: job.status_message,
          completedAt: job.completed_at,
          failedAt: job.failed_at,
        })),
      }));
      return;
    }

    res.json(AiJobListResponseSchema.parse({
      jobs: [],
    }));
  } catch (err) {
    if (err instanceof AppError || err instanceof HttpError) {
      next(err);
      return;
    }
    if (isAiJobStoreUnavailableError(err)) {
      logger.warn({ err, staffId: req.user!.id }, 'AI job durable store unavailable while listing jobs; returning empty list');
      res.json(AiJobListResponseSchema.parse({ jobs: [] }));
      return;
    }
    logger.warn({ err, staffId: req.user!.id }, 'Failed to list AI jobs');
    next(new AppError('Failed to list AI jobs', 500, 'AI_JOB_LIST_ERROR'));
  }
});

// ── Phase 4 + 5 lane capabilities ──
//
// Read-only, PHI-free. Smoke jobs (staging + production) hit this endpoint
// to prove that the active environment exposes the operator-required lane
// telemetry (backend alias, deployment id/version, promptPrefixHash sample,
// cached_tokens telemetry availability, per-lane SLO + health).
router.get('/capabilities', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getClinicAiRuntimeSettings } = await import('./modelRouter/clinicAiRuntimeSettings');
    const { buildAiCapabilitiesResponse } = await import('./aiCapabilities');
    const runtime = await getClinicAiRuntimeSettings(req.clinicId!);
    const { AiCapabilitiesResponseSchema } = await import('@signacare/shared');
    const sovereignEnabled = (process.env.SOVEREIGN_GPU_LANE_ENABLED ?? 'false').toLowerCase() === 'true';
    const response = buildAiCapabilitiesResponse({
      runtime,
      stagingSmokeRequired: true,
      productionSmokeRequired: true,
      laneProbe: {
        azureOpenAi: {
          endpointConfigured: Boolean(config.azureOpenAi?.endpoint),
          authMode: config.azureOpenAi?.authMode ?? 'managed_identity',
          apiKeyConfigured: Boolean(config.azureOpenAi?.apiKey),
          fastClinicalDeployment: config.azureOpenAi?.fastClinicalDeployment ?? null,
          bestClinicalDeployment: config.azureOpenAi?.bestClinicalDeployment ?? null,
          fastClinicalModelVersion: config.azureOpenAi?.fastClinicalModelVersion ?? null,
          bestClinicalModelVersion: config.azureOpenAi?.bestClinicalModelVersion ?? null,
          privateNetworkEnforced: config.azureOpenAi?.privateNetworkEnforced ?? false,
        },
        sovereignGpu: {
          enabled: sovereignEnabled,
          inferenceImage: process.env.SOVEREIGN_INFERENCE_IMAGE ?? null,
          inferenceModelManifestSha256: process.env.SOVEREIGN_INFERENCE_MODEL_MANIFEST_SHA256 ?? null,
        },
        localOllama: {
          baseUrl: config.ollama?.baseUrl ?? null,
          model: config.ollama?.model ?? null,
        },
      },
    });
    res.json(AiCapabilitiesResponseSchema.parse(response));
  } catch (err) {
    next(err);
  }
});

export default router;
