import { randomUUID } from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { SCRIBE_MULTISPEAKER_MDT_GA_FLAG } from '@signacare/shared';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireClinicModuleEnabled } from '../../middleware/clinicModuleMiddleware';
import { uploadLimiter } from '../../middleware/rateLimiters';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { AppError } from '../../shared/errors';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';
import { isFeatureEnabled } from '../../shared/featureFlags';
import { verifyRecordingConsent } from '../../shared/recordingConsent';
import { ambientAudioMaxBytes } from '../../shared/ambientScribeConfig';
import { getRetentionForClinic } from '../../mcp/scribeAudioRetention';
import { ambientUploadSemaphore } from '../../utils/semaphore';
import { buildAmbientAudioTooLargeResponse } from './ambientNoteResponses';
import { AmbientNoteRequestSchema } from './ambientNoteSchemas';
import { AI_QUEUE_NAME, type AiJobData } from '../../jobs/workers/aiWorker';
import { getAiJobQueuePriority } from '../../jobs/workers/aiJobRetryDiscipline';
import { createAiJobRun, summarizeAiJobInput, updateAiJobRun } from './aiJobStore';
import { toAiJobQueueSubmitError } from './aiJobRouteSupport';

const AmbientNoteJobQueuedResponseSchema = z.object({
  jobId: z.string().uuid(),
  action: z.literal('ambient-audio'),
  status: z.literal('queued'),
  pollingUrl: z.string().min(1),
  message: z.string().min(1),
});

const aiJobConnection = new IORedis(config.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const aiJobQueue = new Queue<AiJobData>(AI_QUEUE_NAME, { connection: aiJobConnection });

export function registerAmbientNoteAsyncJobRoute(router: Router): void {
  router.post(
    '/ambient-note/jobs',
    uploadLimiter,
    requireRoles(['clinician', 'admin', 'superadmin']),
    requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE),
    requireClinicModuleEnabled(MODULE_KEYS.MEDICAL_SCRIBE),
    async (req: Request, res: Response, next: NextFunction) => {
      let ambientUploadSlotAcquired = false;
      let uploadedAudioKey: string | null = null;
      let jobIdForCleanup: string | null = null;
      let queueAccepted = false;
      try {
        ambientUploadSlotAcquired = ambientUploadSemaphore.tryAcquire();
        if (!ambientUploadSlotAcquired) {
          throw new AppError(
            'Ambient scribe is already accepting another recording. Please wait and retry.',
            429,
            'AMBIENT_UPLOAD_CAPACITY_EXHAUSTED',
          );
        }

        const multer = (await import('multer')).default;
        const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: ambientAudioMaxBytes() } });
        await new Promise<void>((resolve, reject) => {
          upload.single('audio')(req, res, (err: unknown) => err ? reject(err) : resolve());
        });

        const dto = AmbientNoteRequestSchema.parse(req.body);
        const multiSpeakerRequested = dto.multiSpeakerMode === true || dto.multiSpeakerMode === 'true';
        if (multiSpeakerRequested) {
          const multiSpeakerEnabled = await isFeatureEnabled(
            SCRIBE_MULTISPEAKER_MDT_GA_FLAG,
            req.clinicId ?? null,
            { staffId: req.user?.id },
          );
          if (!multiSpeakerEnabled) {
            throw new AppError(
              `Feature '${SCRIBE_MULTISPEAKER_MDT_GA_FLAG}' is currently disabled for this clinic`,
              403,
              'FEATURE_DISABLED',
              { flag: SCRIBE_MULTISPEAKER_MDT_GA_FLAG },
            );
          }
        }

        const auth = buildAuthContext(req, dto.patientId);
        await requirePatientRelationship(auth, dto.patientId);
        await verifyRecordingConsent(req.clinicId, dto.patientId, dto.consentId);

        const audioFile = req.file;
        if (!audioFile) {
          throw new AppError('No audio file provided', 400, 'AUDIO_UPLOAD_MISSING');
        }
        if (audioFile.size < 1000) {
          throw new AppError('Audio file too small. Please record at least a few seconds.', 400, 'AUDIO_UPLOAD_TOO_SMALL');
        }

        const { blobStorage } = await import('../../shared/blobStorage');
        const ext = audioFile.mimetype?.includes('mp4') ? '.mp4' : audioFile.mimetype?.includes('aac') ? '.aac' : '.webm';
        const now = new Date();
        const yyyy = String(now.getUTCFullYear());
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const audioFilename = `${randomUUID()}${ext}`;
        const audioStorageKey = `audio/${yyyy}/${mm}/${audioFilename}`;
        const audioBuffer = Buffer.isBuffer(audioFile.buffer) ? audioFile.buffer : Buffer.alloc(0);
        if (audioBuffer.length === 0) {
          throw new AppError('Audio upload was not retained for processing', 400, 'AUDIO_UPLOAD_EMPTY');
        }

        const audioPut = await blobStorage.put(audioStorageKey, audioBuffer, audioFile.mimetype || 'audio/webm');
        uploadedAudioKey = audioPut.key;
        await verifyRecordingConsent(req.clinicId, dto.patientId, dto.consentId);
        const audioRetentionPolicy = await getRetentionForClinic(req.clinicId!);

        await writeAuditLog({
          clinicId: req.clinicId,
          userId: req.user!.id,
          action: 'AMBIENT_NOTE_RECORDING_QUEUED',
          tableName: 'scribe_consents',
          recordId: dto.consentId,
          newData: {
            patientId: dto.patientId,
            audioStorageKey: audioPut.key,
            audioRetentionPolicy,
            async: true,
          },
        });

        const jobId = randomUUID();
        const payload = {
          audioStorageKey: audioPut.key,
          audioStorageBackend: audioPut.backend,
          audioStorageBucket: audioPut.bucket,
          mimeType: audioFile.mimetype || 'audio/webm',
          patientId: dto.patientId,
          consentId: dto.consentId,
          outputFormat: dto.format ?? 'soap',
          interpreterUsed: dto.interpreterUsed === 'true' || dto.interpreterUsed === true,
          interpreterLanguage: dto.interpreterLanguage || undefined,
          model: dto.model,
          audioRetentionPolicy,
        };
        const jobData: AiJobData = {
          jobId,
          action: 'ambient-audio',
          data: JSON.stringify(payload),
          model: dto.model,
          patientId: dto.patientId,
          staffId: req.user!.id,
          clinicId: req.clinicId,
        };
        jobIdForCleanup = jobId;

        await createAiJobRun({
          jobId,
          clinicId: req.clinicId!,
          staffId: req.user!.id,
          patientId: dto.patientId,
          consentId: dto.consentId,
          action: 'ambient-audio',
          model: dto.model ?? null,
          inputSummary: summarizeAiJobInput(`Ambient recording ${audioFile.size} bytes; format=${dto.format ?? 'soap'}`),
          queuePayload: payload,
          audioStorageKey: audioPut.key,
          audioStorageBackend: audioPut.backend,
          audioStorageBucket: audioPut.bucket,
          audioMimeType: audioFile.mimetype || 'audio/webm',
          audioRetentionPolicy,
        });

        try {
          await aiJobQueue.add('ambient-audio', jobData, {
            jobId,
            priority: getAiJobQueuePriority('ambient-audio'),
            attempts: 1,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: { age: 14 * 86400 },
            removeOnFail: { age: 30 * 86400 },
          });
          queueAccepted = true;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const submitError = toAiJobQueueSubmitError(err);
          await updateAiJobRun(req.clinicId!, jobId, {
            status: 'failed',
            progressPercent: 0,
            stage: 'queue_submit_failed',
            statusMessage:
              submitError.code === 'AI_JOB_QUEUE_UNAVAILABLE'
                ? 'Background AI queue unavailable'
                : 'Failed to submit ambient recording to queue',
            errorCode: submitError.code,
            errorMessage: message,
            failedAt: new Date(),
          }, req.user!.id);
          throw submitError;
        }

        res.status(202).json(AmbientNoteJobQueuedResponseSchema.parse({
          jobId,
          action: 'ambient-audio',
          status: 'queued',
          pollingUrl: `/api/v1/ai/jobs/${jobId}`,
          message: 'Ambient recording queued. The note will continue processing if this browser disconnects.',
        }));
      } catch (err) {
        if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'LIMIT_FILE_SIZE') {
          const response = buildAmbientAudioTooLargeResponse();
          next(new AppError(response.error, 413, response.code, {
            targetMinutes: response.targetMinutes,
          }));
          return;
        }
        if (uploadedAudioKey && !queueAccepted) {
          try {
            const { blobStorage } = await import('../../shared/blobStorage');
            await blobStorage.delete(uploadedAudioKey);
            if (jobIdForCleanup) {
              await updateAiJobRun(req.clinicId!, jobIdForCleanup, {
                audioRetentionPolicy: 'queue_orphan_deleted',
                audioDeletedAt: new Date(),
              }, req.user!.id);
            }
          } catch (cleanupErr) {
            logger.warn(
              {
                err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                audioStorageKey: uploadedAudioKey,
              },
              'Async ambient upload cleanup failed after queue error',
            );
          }
        }
        next(err);
      } finally {
        if (ambientUploadSlotAcquired) ambientUploadSemaphore.release();
      }
    },
  );
}
