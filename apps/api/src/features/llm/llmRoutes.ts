import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  LETTER_DRAFT_SENSITIVE_FILTER_BYPASS_FLAG,
  AlertCalibrationFeedbackSignalSchema,
  SCRIBE_MULTISPEAKER_MDT_GA_FLAG,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireClinicModuleEnabled } from '../../middleware/clinicModuleMiddleware';
import { requireFeatureEnabled } from '../../middleware/featureFlagMiddleware';
import { uploadLimiter } from '../../middleware/rateLimiters';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { logger } from '../../utils/logger';
import { HttpError, AppError } from '../../shared/errors';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';
import { recordLlmInteraction } from '../../shared/recordLlmInteraction';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import { writeLlmAccessBypassAudit } from '../../shared/writeLlmAccessBypassAudit';
import { isFeatureEnabled } from '../../shared/featureFlags';
import { acquireChatPatientLock } from './chatContextLock';
import { applyLetterDraftSafetyForRoute } from './letterDraftSafety';
import { buildMseStructuredContract } from './mseStructured';
import { registerHuggingFaceRoutes } from './llmHfRegistrar';
import { authorizeAiRequest, type AiDecisionToken } from '../ai/policy/aiPolicy';
import { guardAiTextEgress } from '../ai/egress/responseGuard';
import { verifyRecordingConsent } from '../../shared/recordingConsent';
import {
  ambientAudioMaxBytes,
  ambientHttpTimeoutMs,
} from '../../shared/ambientScribeConfig';
import { ambientUploadSemaphore } from '../../utils/semaphore';
import { resolveLlmHttpTimeoutMs } from '../../shared/llmHttpTimeout';
import {
  recordAlertCalibrationFeedback,
  recordScribeReadabilitySignal,
} from '../../shared/postDeployTelemetry';
import {
  buildAmbientAudioTooLargeResponse,
  buildAmbientProcessingTimeoutResponse,
} from './ambientNoteResponses';
import { AmbientNoteRequestSchema } from './ambientNoteSchemas';
import { registerAmbientNoteAsyncJobRoute } from './ambientNoteAsyncJobRoute';
import { assertSyncClinicalAiRouteAllowed } from './asyncClinicalAiGuard';
import {
  recordInteraction,
  getClinicUsage,
  getUserUsage,
  suggest,
} from './llmController';
import { probeWhisperHealth } from './whisperHealthProbe';

const ClinicalAiResponseSchema = z.object({ result: z.string(), action: z.string(), model: z.string().optional(), disclaimer: z.string() });
const ClinicalAiEnhancedResponseSchema = ClinicalAiResponseSchema.extend({ enriched: z.unknown().optional(), sections: z.unknown().optional() });
if (typeof verifyRecordingConsent !== 'function') {
  throw new Error(
    '[BUG-035] verifyRecordingConsent not exported from shared/recordingConsent — ' +
      'ambient-note consent gate is broken. A silent refactor has removed the ' +
      'shared helper. See docs/audit-2026-04-19/bug-plans/BUG-035-ambient-note-consent.md.',
  );
}
const router = Router();
router.use(authMiddleware);
registerAmbientNoteAsyncJobRoute(router);
async function applyLetterDraftSafetyForClinicalAi(params: {
  req: Request;
  action: string;
  patientId: string | undefined;
  rawResult: string;
}): Promise<string> {
  const bypassEnabled = await isFeatureEnabled(
    LETTER_DRAFT_SENSITIVE_FILTER_BYPASS_FLAG,
    params.req.clinicId ?? null,
    { staffId: params.req.user?.id },
  );
  return applyLetterDraftSafetyForRoute({
    action: params.action,
    patientId: params.patientId,
    rawResult: params.rawResult,
    bypassEnabled,
    clinicId: params.req.clinicId ?? null,
    staffId: params.req.user?.id ?? null,
    bypassFlagName: LETTER_DRAFT_SENSITIVE_FILTER_BYPASS_FLAG,
  });
}
router.post(
  '/interactions',
  requireRoles(['clinician', 'admin', 'superadmin']),
  recordInteraction,
);
router.get(
  '/usage',
  requireRoles(['manager', 'superadmin', 'superadmin']),
  getClinicUsage,
);
router.get(
  '/usage/:userId',
  requireRoles(['manager', 'superadmin', 'superadmin']),
  getUserUsage,
);

router.post(
  '/suggest',
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleRead(MODULE_KEYS.AI),
  requireFeatureEnabled('ai-chat'),
  authorizeAiRequest({
    routeId: 'suggest',
    allowedPurposes: ['clinical', 'operational', 'analytics'],
  }),
  suggest,
);

registerHuggingFaceRoutes(router);

router.post(
  '/clinical-ai',
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleRead(MODULE_KEYS.AI),
  authorizeAiRequest({
    routeId: 'clinical-ai',
    allowedPurposes: ['clinical', 'operational'],
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    const llmHttpTimeoutMs = resolveLlmHttpTimeoutMs();
    req.setTimeout(llmHttpTimeoutMs);
    res.setTimeout(llmHttpTimeoutMs);
    try {
      const { ClinicalAiSchema } = await import('@signacare/shared');
      ClinicalAiSchema.parse(req.body);
      const { action, data, model, patientId, enhance, conversationId } = req.body;
      const aiDecisionToken = (res.locals as { aiDecisionToken?: AiDecisionToken }).aiDecisionToken;
      const aiPolicyDecision = (res.locals as {
        aiPolicyDecision?: {
          purposeOfUse: 'clinical' | 'operational' | 'analytics';
          scope: {
            level: 'patient' | 'team' | 'staff' | 'clinic';
            patientIds?: string[];
            teamIds?: string[];
            staffIds?: string[];
            teamLabels?: string[];
            staffLabels?: string[];
            timeRangeFrom?: string;
            timeRangeTo?: string;
          };
        };
      }).aiPolicyDecision;

      const purposeOfUse = aiPolicyDecision?.purposeOfUse ?? 'clinical';
      const scope = aiPolicyDecision?.scope;
      const enhanceAuth = patientId
        ? {
          ...buildAuthContext(req, patientId),
          aiPurposeOfUse: purposeOfUse,
          aiScope: scope,
          aiDecisionToken,
          aiAllowedTools: aiDecisionToken?.allowedTools,
        }
        : null;
      if (patientId && enhanceAuth) {
        // BUG-036 — patient-relationship gate
        await requirePatientRelationship(enhanceAuth, patientId);
      }

      if (conversationId && patientId) {
        const lockResult = await acquireChatPatientLock(conversationId, patientId);
        if (!lockResult.ok) {
          const reason = 'lockedPatientId' in lockResult && lockResult.lockedPatientId
            ? 'cross-patient switch'
            : 'redis-failure';
          await writeAuditLog({
            clinicId: req.clinicId!,
            actorId: req.user?.id ?? '',
            tableName: 'llm_interactions',
            recordId: conversationId,
            action: 'AI_CHAT_CONTEXT_VIOLATION',
            newData: {
              conversationId,
              requestedPatientId: patientId,
              lockedPatientId: 'lockedPatientId' in lockResult ? lockResult.lockedPatientId ?? null : null,
              reason,
            },
          });
          if ('lockedPatientId' in lockResult && lockResult.lockedPatientId) {
            throw new AppError(
              `Chat conversation is locked to a different patient. Start a new conversation to switch patient context.`,
              409,
              'CHAT_CONTEXT_LOCKED',
            );
          }
          throw new AppError(
            'Chat context lock is temporarily unavailable. Please retry in a moment.',
            503,
            'CHAT_CONTEXT_LOCK_UNAVAILABLE',
          );
        }
      }

      assertSyncClinicalAiRouteAllowed(action, patientId);

      if (enhance !== false && patientId) {
        const { enhancedGenerate } = await import('../../mcp/aiEnhancer');
        const output = await enhancedGenerate({
          action,
          data,
          patientId,
          auth: enhanceAuth ?? undefined,  // BUG-281 AuthContext for the RAG gate
          clinicId: req.clinicId,
          model,
          refine: enhance !== 'draft',
        });
        const cleanEnhanced = (output.result || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/^###?\s+/gm, '').replace(/^#+\s+/gm, '').replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1').trim();
        const safeEnhanced = await applyLetterDraftSafetyForClinicalAi({
          req,
          action,
          patientId,
          rawResult: cleanEnhanced,
        });
        const egressChecked = guardAiTextEgress({
          routeId: 'clinical-ai',
          auth: enhanceAuth ?? {
            ...buildAuthContext(req, patientId),
            aiPurposeOfUse: purposeOfUse,
            aiScope: scope,
            aiDecisionToken,
            aiAllowedTools: aiDecisionToken?.allowedTools,
          },
          text: safeEnhanced,
        });
        await writeLlmAccessBypassAudit({
          req,
          patientId: patientId ?? null,
          endpoint: '/llm/clinical-ai',
          feature: typeof action === 'string' ? `clinical-ai:${action}` : 'clinical-ai',
        });
        recordScribeReadabilitySignal({
          feature: `clinical-ai:${action}`,
          text: egressChecked.safeText,
        });
        res.json(ClinicalAiEnhancedResponseSchema.parse({ result: egressChecked.safeText, action, model: output.model, enriched: output.enriched, sections: output.sections, disclaimer: CLINICAL_AI_DISCLAIMER }));
        return;
      }

      const { generateClinicalAction } = await import('./modelRouter/modelRouter');
      const normalizedData = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const routed = await generateClinicalAction({
        clinicId: req.clinicId,
        action: action as Parameters<typeof generateClinicalAction>[0]['action'],
        data: normalizedData,
        templateType: req.body.templateType,
        requestedModel: model,
      });
      const result = routed.text;
      const cleanResult = result
        .replace(/\*\*(.*?)\*\*/g, '$1')     // **bold** → bold
        .replace(/__(.*?)__/g, '$1')          // __underline__ → underline
        .replace(/~~(.*?)~~/g, '$1')          // ~~strike~~ → strike
        .replace(/^###?\s+/gm, '')            // ## Heading → Heading
        .replace(/^#+\s+/gm, '')              // # Heading → Heading
        .replace(/```[\s\S]*?```/g, '')       // code blocks
        .replace(/`([^`]+)`/g, '$1')          // inline code
        .replace(/^\s*[-*]\s+/gm, '• ')       // - bullet → • bullet
        .replace(/^\s*\d+\.\s+/gm, (m) => m) // keep numbered lists
        .trim();
      const safeResult = await applyLetterDraftSafetyForClinicalAi({
        req,
        action,
        patientId,
        rawResult: cleanResult,
      });
      const egressChecked = guardAiTextEgress({
        routeId: 'clinical-ai',
        auth: {
          ...buildAuthContext(req, patientId),
          aiPurposeOfUse: purposeOfUse,
          aiScope: scope,
          aiDecisionToken,
          aiAllowedTools: aiDecisionToken?.allowedTools,
        },
        text: safeResult,
      });
      await writeLlmAccessBypassAudit({
        req,
        patientId: patientId ?? null,
          endpoint: '/llm/clinical-ai',
          feature: typeof action === 'string' ? `clinical-ai:${action}` : 'clinical-ai',
      });
      recordScribeReadabilitySignal({
        feature: `clinical-ai:${action}`,
        text: egressChecked.safeText,
      });
      res.json(ClinicalAiResponseSchema.parse({
        result: egressChecked.safeText,
        action,
        model: routed.execution.modelName,
        disclaimer: CLINICAL_AI_DISCLAIMER,
      }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/feedback',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { AiFeedbackSchema } = await import('@signacare/shared');
      AiFeedbackSchema.parse(req.body);
      const { saveFeedback } = await import('../../mcp/trainingPipeline');
      const id = await saveFeedback({ ...req.body, clinicId: req.clinicId, staffId: req.user!.id });
      res.json({ ok: true, id });
    } catch (err) { next(err); }
  },
);

router.post(
  '/telemetry/alert-feedback',
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleRead(MODULE_KEYS.AI),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = AlertCalibrationFeedbackSignalSchema.parse({
        ...req.body,
        generatedAt: new Date().toISOString(),
      });
      recordAlertCalibrationFeedback(dto);
      await writeAuditLog({
        clinicId: req.clinicId,
        actorId: req.user?.id ?? '',
        action: 'UPDATE',
        tableName: 'staff',
        recordId: req.user?.id ?? '00000000-0000-0000-0000-000000000000',
        newData: { kind: 'ai_alert_calibration_feedback', ...dto },
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/training/stats',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { getTrainingStats } = await import('../../mcp/trainingPipeline');
      const stats = await getTrainingStats(req.clinicId);
      res.json(stats);
    } catch (err) { next(err); }
  },
);


router.post(
  '/training/export-requests',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { db } = await import('../../db/db');
      const { writeAuditLog } = await import('../../utils/audit');
      const body = req.body as { format?: 'alpaca' | 'chatml'; reason?: string } | undefined;
      const format = body?.format === 'chatml' ? 'chatml' : 'alpaca';
      const { randomUUID } = await import('crypto');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);  // 24h
      const [row] = await db('training_export_requests')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          requested_by_id: req.user!.id,
          requested_at: new Date(),
          status: 'pending',
          format,
          reason: typeof body?.reason === 'string' ? body.reason : null,
          expires_at: expiresAt,
          created_at: new Date(),
        })
        .returning(['id', 'clinic_id', 'status', 'format', 'expires_at']);
      await writeAuditLog({
        clinicId: req.clinicId, actorId: req.user!.id,
        action: 'TRAINING_EXPORT_REQUESTED',
        tableName: 'training_export_requests', recordId: row.id,
        newValues: { format, reason: body?.reason ?? null },
      }).catch((err: unknown) => logger.error(
        { err, recordId: row.id, actorId: req.user!.id, action: 'TRAINING_EXPORT_REQUESTED', kind: 'tier_5_9_audit_write_failed' },
        'BUG-360: Tier 5.9 two-person training-export audit write failed — regulator-facing attestation gap',
      ));
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

router.get(
  '/training/export-requests',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { db } = await import('../../db/db');
      const rows = await db('training_export_requests')
        .where({ clinic_id: req.clinicId })
        .orderBy('requested_at', 'desc')
        .limit(100)
        .select(
          'id', 'status', 'format', 'reason', 'rejection_reason',
          'requested_by_id', 'requested_at',
          'approved_by_id', 'approved_at',
          'downloaded_at', 'row_count', 'expires_at',
        );
      res.json({ requests: rows });
    } catch (err) { next(err); }
  },
);

router.patch(
  '/training/export-requests/:id',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { db } = await import('../../db/db');
      const { writeAuditLog } = await import('../../utils/audit');
      const { randomUUID } = await import('crypto');
      const body = req.body as { decision?: 'approve' | 'reject'; rejectionReason?: string } | undefined;
      if (body?.decision !== 'approve' && body?.decision !== 'reject') {
        res.status(400).json({ error: 'invalid_decision' });
        return;
      }
      const existing = await db('training_export_requests')
        .where({ id: req.params.id, clinic_id: req.clinicId }).first();
      if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
      if (existing.status !== 'pending') {
        res.status(409).json({ error: 'already_decided', status: existing.status });
        return;
      }
      if (existing.requested_by_id === req.user!.id) {
        res.status(403).json({
          error: 'self_approval_forbidden',
          message: 'A second admin must approve — the requester cannot approve their own request.',
        });
        return;
      }
      const patch: Record<string, unknown> = {
        approved_by_id: req.user!.id,
        approved_at: new Date(),
      };
      if (body.decision === 'approve') {
        patch.status = 'approved';
        patch.download_token = randomUUID();
      } else {
        patch.status = 'rejected';
        patch.rejection_reason = typeof body.rejectionReason === 'string' ? body.rejectionReason : null;
      }
      await db('training_export_requests').where({ id: req.params.id }).update(patch);
      await writeAuditLog({
        clinicId: req.clinicId, actorId: req.user!.id,
        action: body.decision === 'approve' ? 'TRAINING_EXPORT_APPROVED' : 'TRAINING_EXPORT_REJECTED',
        tableName: 'training_export_requests', recordId: req.params.id,
        newValues: { decision: body.decision, rejection_reason: body.rejectionReason ?? null },
      }).catch((err: unknown) => logger.error(
        { err, recordId: req.params.id, actorId: req.user!.id, decision: body.decision, kind: 'tier_5_9_audit_write_failed' },
        'BUG-360: Tier 5.9 two-person approval audit write failed — regulator-facing attestation gap',
      ));
      const updated = await db('training_export_requests').where({ id: req.params.id }).first();
      res.json({
        id: updated.id,
        status: updated.status,
        downloadToken: updated.download_token ?? null,
      });
    } catch (err) { next(err); }
  },
);

router.get(
  '/training/export',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { db } = await import('../../db/db');
      const { writeAuditLog } = await import('../../utils/audit');
      const token = typeof req.query.token === 'string' ? req.query.token : null;
      if (!token) {
        res.status(400).json({
          error: 'token_required',
          message: 'Training export requires a single-use approval token. ' +
            'Open a request via POST /llm/training/export-requests and have a second admin approve it.',
        });
        return;
      }
      const row = await db('training_export_requests')
        .where({ download_token: token, clinic_id: req.clinicId })
        .first();
      if (!row) { res.status(404).json({ error: 'token_not_found' }); return; }
      if (row.status !== 'approved') {
        res.status(410).json({ error: 'token_already_used_or_expired', status: row.status });
        return;
      }
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        await db('training_export_requests').where({ id: row.id }).update({ status: 'expired' });
        res.status(410).json({ error: 'token_expired' });
        return;
      }
      const { exportTrainingData, toJsonl, toChatMl } = await import('../../mcp/trainingPipeline');
      const examples = await exportTrainingData(req.clinicId);
      const jsonl = row.format === 'chatml' ? toChatMl(examples) : toJsonl(examples);
      await db('training_export_requests').where({ id: row.id }).update({
        status: 'downloaded',
        downloaded_at: new Date(),
        row_count: examples.length,
      });
      try {
        await writeAuditLog({
          clinicId: req.clinicId, actorId: req.user!.id,
          action: 'TRAINING_EXPORT_DOWNLOADED',
          tableName: 'training_export_requests', recordId: row.id,
          newValues: { row_count: examples.length, format: row.format },
        });
      } catch (err) {
        logger.error(
          { err, recordId: row.id, actorId: req.user!.id, rowCount: examples.length, kind: 'tier_5_9_audit_write_failed' },
          'BUG-360: Tier 5.9 training-export DOWNLOAD audit write failed — refusing to stream JSONL (regulator-facing attestation required)',
        );
        res.status(503).json({
          error: 'Audit trail unavailable — download rejected',
          code: 'AUDIT_WRITE_FAILED',
          message: 'Training data export cannot proceed without a successful audit row. Please retry after audit infrastructure is restored.',
        });
        return;
      }
      res.setHeader('Content-Type', 'application/jsonl');
      res.setHeader('Content-Disposition', `attachment; filename="signacare_training_${row.format}_${new Date().toISOString().split('T')[0]}.jsonl"`);
      res.send(jsonl);
    } catch (err) { next(err); }
  },
);

router.post(
  '/ambient-note',
  uploadLimiter,
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE),
  requireClinicModuleEnabled(MODULE_KEYS.MEDICAL_SCRIBE),
  async (req: Request, res: Response, next: NextFunction) => {
    let ambientUploadSlotAcquired = false;
    const ambientTimeoutMs = ambientHttpTimeoutMs();
    req.setTimeout(ambientTimeoutMs);
    res.setTimeout(ambientTimeoutMs);

    try {
      ambientUploadSlotAcquired = ambientUploadSemaphore.tryAcquire();
      if (!ambientUploadSlotAcquired) {
        throw new AppError(
          'Ambient scribe is already processing another recording. Please wait and retry.',
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
          return next(
            new AppError(
              `Feature '${SCRIBE_MULTISPEAKER_MDT_GA_FLAG}' is currently disabled for this clinic`,
              403,
              'FEATURE_DISABLED',
              { flag: SCRIBE_MULTISPEAKER_MDT_GA_FLAG },
            ),
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

      const { randomUUID } = await import('crypto');
      const { blobStorage } = await import('../../shared/blobStorage');
      const ext = audioFile.mimetype?.includes('mp4') ? '.mp4' : audioFile.mimetype?.includes('aac') ? '.aac' : '.webm';
      const now = new Date();
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const audioFilename = `${randomUUID()}${ext}`;
      const audioStorageKey = `audio/${yyyy}/${mm}/${audioFilename}`;
      const audioBuffer = Buffer.isBuffer(audioFile.buffer)
        ? audioFile.buffer
        : Buffer.alloc(0);
      if (audioBuffer.length === 0) {
        throw new AppError('Audio upload was not retained for processing', 400, 'AUDIO_UPLOAD_EMPTY');
      }
      const audioPut = await blobStorage.put(audioStorageKey, audioBuffer, audioFile.mimetype || 'audio/webm');

      const assertConsentStillActive = async (checkpoint: 'post_upload_pre_processing' | 'post_processing_pre_save') => {
        try {
          await verifyRecordingConsent(req.clinicId, dto.patientId, dto.consentId);
        } catch (err) {
          const errorRecord = err != null && typeof err === 'object'
            ? (err as Record<string, unknown>)
            : null;
          const consentCode = String(errorRecord?.code ?? '');
          const consentStatus = typeof errorRecord?.status === 'number'
            ? errorRecord.status
            : undefined;
          const consentBoundaryError =
            consentCode.startsWith('CONSENT_')
            && (err instanceof HttpError || consentStatus === 403);
          if (consentBoundaryError) {
            try {
              await blobStorage.delete(audioPut.key);
            } catch (cleanupErr) {
              logger.warn(
                {
                  clinicId: req.clinicId,
                  patientId: dto.patientId,
                  consentId: dto.consentId,
                  checkpoint,
                  cleanupError: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                },
                '[BUG-WF51-CONSENT-REVOKE-RACE] ambient-note revoke cleanup failed',
              );
            }
            logger.warn(
              {
                clinicId: req.clinicId,
                patientId: dto.patientId,
                consentId: dto.consentId,
                checkpoint,
                consentCode,
              },
              '[BUG-WF51-CONSENT-REVOKE-RACE] consent became inactive during ambient-note processing',
            );
          }
          throw err;
        }
      };

      await assertConsentStillActive('post_upload_pre_processing');

      await writeAuditLog({
        clinicId: req.clinicId,
        userId: req.user!.id,
        action: 'AMBIENT_NOTE_RECORDING_STARTED',
        tableName: 'scribe_consents',
        recordId: dto.consentId,
        newData: { patientId: dto.patientId, audioStorageKey: audioPut.key },
      });

      const { processAmbientAudio } = await import('../../mcp/ambientProcessor');
      const result: Awaited<ReturnType<typeof processAmbientAudio>> & {
        audioStorageKey?: string;
        audioFilePath?: string;
        savedNoteId?: string;
        saveError?: string;
        codeSaveError?: string;
        mseStructured?: ReturnType<typeof buildMseStructuredContract>;
      } = await processAmbientAudio(audioBuffer, audioFile.mimetype, {
        clinicId: req.clinicId,
        staffId: req.user!.id,
        patientId: dto.patientId,
        auth,
        consentId: dto.consentId,
        model: dto.model,
        outputFormat: dto.format ?? 'soap',
        interpreterUsed: dto.interpreterUsed === 'true' || dto.interpreterUsed === true,
        interpreterLanguage: dto.interpreterLanguage || undefined,
      });
      await assertConsentStillActive('post_processing_pre_save');

      result.audioStorageKey = audioPut.key;
      result.audioFilePath = audioPut.bucket === 'local'
        ? `uploads/${audioPut.key}`
        : audioPut.key;
      result.mseStructured = buildMseStructuredContract({
        sourceSessionId: null,
        mentalStateExam: result.mentalStateExam,
        citedFacts: result.citedFacts,
      });

      const patientId = req.body?.patientId;
      const hasLlmFallbacks = Boolean(result.llmFallbacks?.pass1 || result.llmFallbacks?.pass3);
      if (hasLlmFallbacks) {
        result.saveError = 'AI output was generated in degraded review-only mode and was not auto-saved. Review the transcript and create a clinical note manually.';
      } else if (patientId && result.summary) {
        try {
          const { db } = await import('../../db/db');
          const { withTenantContext } = await import('../../shared/tenantContext');
          const format = req.body?.format ?? 'soap';
          const structured = result.structured ?? { subjective: '', objective: '', assessment: '', plan: '' };

          const { detectScribeHallucinations } = await import('../../shared/detectScribeHallucinations');
          const transcript = result.transcript ?? '';
          const hallucinationCheck = detectScribeHallucinations(transcript, {
            medications: (result.medications ?? []).map((m) => ({
              name: m.name ?? '',
              dose: m.dose ?? '',
            })),
            diagnoses: (result.suggestedDiagnosis ?? []).map((display) => ({
              display,
              code: '',
            })),
            allergies: [],
            noteText: result.summary ?? '',
          });

          if (!hallucinationCheck.ok) {
            const { writeAuditLog: writeAudit } = await import('../../utils/audit');
            await writeAudit({
              clinicId: req.clinicId!,
              actorId: req.user!.id,
              tableName: 'clinical_notes',
              recordId: '00000000-0000-0000-0000-000000000000',
              action: 'SCRIBE_HALLUCINATION_BLOCKED',
              newData: {
                findings: hallucinationCheck.findings,
                patientId,
              },
            });

            next(new AppError(
              'Review required — potential hallucinations detected',
              422,
              'AI_HALLUCINATION_DETECTED',
              {
              findings: hallucinationCheck.findings,
              summary: result.summary,
              structured,
              },
            ));
            return;
          }

          await withTenantContext(
            req.clinicId,
            async () => {
              const [savedNote] = await db('clinical_notes').insert({
                clinic_id: req.clinicId,
                patient_id: patientId,
                episode_id: req.body?.episodeId ?? null,
                author_id: req.user!.id,
                title: `AI Draft — ${format.toUpperCase()} (${new Date().toLocaleDateString('en-AU')})`,
                note_type: format === 'mse' ? 'mse' : 'soap',
                content: result.summary,
                soap_subjective: structured.subjective ?? null,
                soap_objective: structured.objective ?? null,
                soap_assessment: structured.assessment ?? null,
                soap_plan: structured.plan ?? null,
                status: 'draft',
                is_ai_draft: true,
                consent_id: dto.consentId,
                note_date_time: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
              }).returning('id');
              const savedNoteId = savedNote?.id ?? savedNote;
              result.savedNoteId = savedNoteId;

              const icd10 = result.icd10Suggestions;
              if (savedNoteId && Array.isArray(icd10) && icd10.length > 0) {
                try {
                  await db('clinical_note_codes')
                    .insert(
                      icd10.map((c) => ({
                        note_id: savedNoteId,
                        clinic_id: req.clinicId,
                        system: 'icd-10-am',
                        code: c.code,
                        display: c.description,
                        confidence: c.confidence ?? 'moderate',
                        status: 'suggested',
                        source: 'regex_v1',
                        source_excerpt: c.source ?? null,
                      })),
                    )
                    .onConflict(['note_id', 'system', 'code'])
                    .ignore();
                } catch (codeErr) {
                  result.codeSaveError = codeErr instanceof Error ? codeErr.message : String(codeErr);
                }
              }
            },
            req.user!.id,
          );
        } catch (saveErr) {
          result.saveError = saveErr instanceof Error ? saveErr.message : String(saveErr);
        }
      }

      await writeLlmAccessBypassAudit({
        req,
        patientId: dto.patientId ?? null,
        endpoint: '/llm/ambient-note',
        feature: 'ambient',
      });

      res.json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        next(err);
        return;
      }
      if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'LIMIT_FILE_SIZE') {
        const response = buildAmbientAudioTooLargeResponse();
        next(new AppError(response.error, 413, response.code, {
          targetMinutes: response.targetMinutes,
        }));
        return;
      }
      if (err && typeof err === 'object' && (err as { name?: string }).name === 'ZodError') {
        next(err);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNREFUSED') || msg.includes('connect ECONNREFUSED')) {
        try {
          const { startWhisperServer } = await import('../../jobs/bootstrap');
          await startWhisperServer();
        } catch (_restartErr) {
          void _restartErr;
        }
        next(new AppError(
          'Whisper server was not running. It is now starting — please try again in 15-20 seconds.',
          503,
          'WHISPER_RESTARTING',
        ));
      } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
        const response = buildAmbientProcessingTimeoutResponse();
        next(new AppError(response.error, 504, response.code, {
          targetMinutes: response.targetMinutes,
        }));
      } else if (msg.includes('No speech detected')) {
        next(new AppError(msg, 422, 'NO_SPEECH'));
      } else if (msg.includes('Ollama') || msg.includes('LLM')) {
        next(new AppError('AI model is not available. Ensure Ollama is running.', 503, 'LLM_UNAVAILABLE'));
      } else {
        next(err);
      }
    } finally {
      if (ambientUploadSlotAcquired) ambientUploadSemaphore.release();
    }
  },
);

router.post(
  '/mcp',
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleRead(MODULE_KEYS.AI_AGENT),
  authorizeAiRequest({
    routeId: 'mcp',
    allowedPurposes: ['clinical', 'operational'],
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { McpRequestSchema } = await import('@signacare/shared');
      McpRequestSchema.parse(req.body);
      const { handleMcpRequest } = await import('../../mcp/server/mcpServer');
      const aiDecisionToken = (res.locals as { aiDecisionToken?: AiDecisionToken }).aiDecisionToken;
      const aiPolicyDecision = (res.locals as {
        aiPolicyDecision?: {
          purposeOfUse: 'clinical' | 'operational' | 'analytics';
          scope: {
            level: 'patient' | 'team' | 'staff' | 'clinic';
            patientIds?: string[];
            teamIds?: string[];
            staffIds?: string[];
            teamLabels?: string[];
            staffLabels?: string[];
            timeRangeFrom?: string;
            timeRangeTo?: string;
          };
        };
      }).aiPolicyDecision;
      const mcpAuth = {
        ...buildAuthContext(req),
        aiPurposeOfUse: aiPolicyDecision?.purposeOfUse ?? 'clinical',
        aiScope: aiPolicyDecision?.scope,
        aiDecisionToken,
        aiAllowedTools: aiDecisionToken?.allowedTools,
      };
      const result = await handleMcpRequest(req.body, mcpAuth);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/agent',
  requireRoles(['clinician', 'admin', 'superadmin']),
  requireModuleRead(MODULE_KEYS.AI_AGENT),
  authorizeAiRequest({
    routeId: 'agent',
    allowedPurposes: ['clinical', 'operational'],
  }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { AiAgentSchema } = await import('@signacare/shared');
      const { query, patientId, model, purposeOfUse, scope } = AiAgentSchema.parse(req.body);
      const aiDecisionToken = (res.locals as { aiDecisionToken?: AiDecisionToken }).aiDecisionToken;
      const aiPolicyDecision = (res.locals as {
        aiPolicyDecision?: {
          purposeOfUse: 'clinical' | 'operational' | 'analytics';
          scope: {
            level: 'patient' | 'team' | 'staff' | 'clinic';
            patientIds?: string[];
            teamIds?: string[];
            staffIds?: string[];
            teamLabels?: string[];
            staffLabels?: string[];
            timeRangeFrom?: string;
            timeRangeTo?: string;
          };
        };
      }).aiPolicyDecision;

      const agentAuth = {
        ...buildAuthContext(req, patientId),
        aiPurposeOfUse: aiPolicyDecision?.purposeOfUse ?? purposeOfUse ?? 'clinical',
        aiScope: aiPolicyDecision?.scope ?? scope,
        aiDecisionToken,
        aiAllowedTools: aiDecisionToken?.allowedTools,
      };
      if (patientId) {
        await requirePatientRelationship(agentAuth, patientId);
      }

      const { runAgent } = await import('../../mcp/server/aiAgent');
      const startMs = Date.now();
      const result = await runAgent(query, agentAuth, model, aiPolicyDecision?.scope ?? scope);
      const routedProvider = result.execution?.backend === 'azure_openai' ? 'azure_openai' : 'ollama', routedModelName = result.execution?.modelName ?? result.model, routedModelVersion = result.execution?.modelVersion ?? result.modelVersion;
      await recordLlmInteraction({
        clinicId: req.clinicId,
        userId: req.user!.id,
        patientId: patientId ?? null,
        feature: 'ai-agent',
        modelName: routedModelName,
        modelVersion: routedModelVersion,
        modelProvider: routedProvider,
        temperature: result.requestedTemperature,
        pipeline: [{
          stage: 'agent_run',
          startedAt: new Date(startMs).toISOString(),
          durationMs: Date.now() - startMs,
          success: true,
          meta: { iterations: result.iterations, toolCalls: result.toolCalls?.length ?? 0 },
        }],
        promptTokens: Math.ceil(query.length / 4),
        completionTokens: Math.ceil((result.answer?.length ?? 0) / 4),
        totalTokens: Math.ceil(query.length / 4) + Math.ceil((result.answer?.length ?? 0) / 4),
        latencyMs: Date.now() - startMs,
        success: true,
        promptText: query,
        outputText: result.answer ?? '',
        consentId: null,
        metadata: {
          versionSource:
            result.execution?.backend === 'azure_openai'
              ? 'provider'
              : result.modelVersion && result.modelVersion !== result.model
                ? 'digest'
                : 'tag',
          routedAlias: result.execution?.alias ?? null,
          routedBackend: result.execution?.backend ?? null,
          routedDeployment: result.execution?.deployment ?? null,
          localStyleAdapterModelName: result.execution?.localStyleAdapterModelName ?? null,
          fallbackFromModelName: result.fallbackFromModelName ?? null,
        },
      });

      await writeLlmAccessBypassAudit({
        req,
        patientId: patientId ?? null,
        endpoint: '/llm/agent',
        feature: 'ai-agent',
      });
      const egressChecked = guardAiTextEgress({
        routeId: 'agent',
        auth: agentAuth,
        text: result.answer,
      });
      res.json({
        ...result,
        answer: egressChecked.safeText,
        disclaimer: CLINICAL_AI_DISCLAIMER,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.code === 'AI_EGRESS_EMPTY') {
          return next(
            new AppError(
              'AI response could not be safely emitted. Please retry.',
              503,
              'AI_RESPONSE_EMPTY',
            ),
          );
        }
        return next(err);
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('connect ECONNREFUSED') ||
        msg.includes('Ollama') ||
        msg.includes('LLM not available') ||
        msg.includes('AI_BACKEND_UNAVAILABLE') ||
        msg.includes('AI_PROVIDER_ERROR')
      ) {
        return next(
          new AppError(
            'AI model is not available. Ensure the configured clinical AI backend is available.',
            503,
            'LLM_UNAVAILABLE',
          ),
        );
      }
      if (msg.toLowerCase().includes('timeout') || msg.includes('ETIMEDOUT')) {
        return next(
          new AppError(
            'AI request timed out. Please retry.',
            504,
            'AI_TIMEOUT',
          ),
        );
      }
      return next(err);
    }
  },
);


router.get('/whisper/status', async (_req: Request, res: Response) => {
  try {
    const url = process.env.WHISPER_API_URL ?? 'http://localhost:8080';
    const healthy = await probeWhisperHealth(url);
    res.json({ running: healthy, url });
  } catch {
    res.json({ running: false });
  }
});

router.post('/whisper/start', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { startWhisperServer } = await import('../../jobs/bootstrap');
    await startWhisperServer();
    await new Promise(r => setTimeout(r, 2000));
    const url = process.env.WHISPER_API_URL ?? 'http://localhost:8080';
    const healthy = await probeWhisperHealth(url);
    res.json({ started: true, running: healthy, message: healthy ? 'Whisper server is running' : 'Whisper server is starting — may take 15-20 seconds for model loading' });
  } catch (err) {
    next(err);
  }
});

import llmTrainingRoutes from './llmTrainingRoutes';
router.use(llmTrainingRoutes);

export default router;
