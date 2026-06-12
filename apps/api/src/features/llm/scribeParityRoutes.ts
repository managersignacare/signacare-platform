import { randomUUID } from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  AuScribeDocumentRequestSchema,
  AuScribeDocumentResponseSchema,
  ScribeOutcomeTelemetryResponseSchema,
  ScribeOutcomeTelemetrySchema,
  ScribeRealtimeDraftSnapshotResponseSchema,
  ScribeRealtimeDraftSnapshotSchema,
  ScribeStyleFeedbackResponseSchema,
  ScribeStyleFeedbackSchema,
  type AuScribeDocumentKind,
} from '@signacare/shared';
import { db } from '../../db/db';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requirePatientRelationship } from '../../shared/authGuards';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError, ErrorCode } from '../../shared/errors';
import { verifyRecordingConsentStillActive } from '../../shared/recordingConsent';
import { createDraftLetter } from './letterService';
import { buildScribeArtifactLineageKey } from './scribeArtifactLineage';
import { recordScribeOutcomeTelemetry } from './scribeOutcomeTelemetry';

const router = Router();

async function requireSessionAccess(req: Request, sessionId: string) {
  const session = await db('scribe_sessions')
    .where({ id: sessionId, clinic_id: req.clinicId })
    .first();
  if (!session) throw new AppError('Session not found', 404, ErrorCode.NOT_FOUND);

  const auth = buildAuthContext(req, session.patient_id);
  await requirePatientRelationship(auth, session.patient_id);

  if (
    session.clinician_id !== req.user!.id &&
    req.user!.role !== 'admin' &&
    req.user!.role !== 'superadmin'
  ) {
    throw new AppError('Forbidden — not the session clinician', 403, ErrorCode.FORBIDDEN);
  }

  return { session, auth };
}

function requireRecordedScribeConsent(session: { consent_id?: string | null }, operation: string): void {
  if (!session.consent_id) {
    throw new AppError(
      `${operation} requires recorded scribe consent`,
      409,
      'SCRIBE_CONSENT_REQUIRED',
    );
  }
}

async function requireActiveScribeConsent(
  clinicId: string,
  session: { patient_id: string; consent_id?: string | null },
  operation: string,
): Promise<void> {
  requireRecordedScribeConsent(session, operation);
  await verifyRecordingConsentStillActive(clinicId, session.patient_id, session.consent_id!);
}

const AU_DOCUMENT_TEMPLATE_CODES: Record<AuScribeDocumentKind, string[]> = {
  gp_referral_letter: ['gp_referral_letter', 'gp_referral', 'referral'],
  mental_health_care_plan: ['mental_health_care_plan', 'mhcp'],
  medical_certificate: ['medical_certificate', 'certificate'],
  court_report_291: ['291', 'court_report_291', 'court_mse_report'],
  mha_tribunal_report: ['mha_tribunal_report', 'tribunal_report'],
  discharge_summary: ['discharge_summary', 'discharge'],
  after_visit_summary: ['after_visit_summary', 'patient_summary'],
};

interface LetterTemplateLookupRow {
  id: string;
  sections?: unknown;
  default_recipients?: unknown;
}

interface LetterTemplateResponse {
  id: string;
  sectionCount: number;
  defaultRecipientCount: number;
}

function jsonArrayLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function letterTemplateToResponse(row: LetterTemplateLookupRow): LetterTemplateResponse {
  return {
    id: row.id,
    sectionCount: jsonArrayLength(row.sections),
    defaultRecipientCount: jsonArrayLength(row.default_recipients),
  };
}

function defaultAuDocumentSubject(kind: AuScribeDocumentKind): string {
  return kind
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

async function resolveAuDocumentTemplateId(
  clinicId: string,
  kind: AuScribeDocumentKind,
  explicitTemplateId?: string,
): Promise<string> {
  if (explicitTemplateId) return explicitTemplateId;

  const template = await db('letter_templates')
    .where({ is_active: true })
    .where(function () {
      this.whereNull('clinic_id').orWhere({ clinic_id: clinicId });
    })
    .whereIn('code', AU_DOCUMENT_TEMPLATE_CODES[kind])
    .select('id', 'sections', 'default_recipients')
    .orderByRaw('CASE WHEN clinic_id = ? THEN 0 ELSE 1 END', [clinicId])
    .orderBy('updated_at', 'desc')
    .first();
  if (!template) {
    throw new AppError(
      `No active AU document template configured for ${kind}`,
      404,
      ErrorCode.NOT_FOUND,
    );
  }
  return letterTemplateToResponse(template as LetterTemplateLookupRow).id;
}

router.post(
  '/session/:id/realtime-draft',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ScribeRealtimeDraftSnapshotSchema.parse(req.body);
      const { session } = await requireSessionAccess(req, req.params.id);
      await requireActiveScribeConsent(req.clinicId!, session, 'Realtime in-visit documentation');
      if (dto.patientId && dto.patientId !== session.patient_id) {
        return next(new AppError('Draft patientId does not match session patient', 409, ErrorCode.CONFLICT));
      }

      const canonicalDraft = [
        dto.partialTranscript,
        ...Object.entries(dto.draftSections).map(([key, value]) => `${key}:${value}`),
      ].join('\n');
      const lineage = buildScribeArtifactLineageKey({
        sourceKind: 'in_visit_draft',
        patientId: session.patient_id,
        sessionId: session.id,
        canonicalText: canonicalDraft,
      });

      await recordScribeOutcomeTelemetry({
        clinicId: req.clinicId!,
        staffId: req.user!.id,
        patientId: session.patient_id,
        sessionId: session.id,
        telemetry: {
          event: 'partial_draft_generated',
          lineageKey: lineage.lineageKey,
        },
      });

      res.json(ScribeRealtimeDraftSnapshotResponseSchema.parse({
        schemaVersion: '1.0',
        sessionId: session.id,
        patientId: session.patient_id,
        sourceChunkIndex: dto.sourceChunkIndex,
        sectionCount: Object.keys(dto.draftSections).length,
        partialTranscriptChars: dto.partialTranscript.length,
        lineage,
        rawDraftPersisted: false,
      }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/session/:id/au-document',
  requireRoles(['clinician', 'admin', 'superadmin', 'psychiatrist']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const startedAt = Date.now();
      const dto = AuScribeDocumentRequestSchema.parse(req.body);
      const { session, auth } = await requireSessionAccess(req, req.params.id);
      await requireActiveScribeConsent(req.clinicId!, session, 'AU document generation');
      const templateId = await resolveAuDocumentTemplateId(
        req.clinicId!,
        dto.documentKind,
        dto.templateId,
      );
      const subject = dto.subject ?? defaultAuDocumentSubject(dto.documentKind);

      const letter = await createDraftLetter(auth, {
        templateId,
        patientId: session.patient_id,
        episodeId: dto.episodeId,
        sessionId: session.id,
        subject,
        recipients: dto.recipients,
      });
      const lineage = buildScribeArtifactLineageKey({
        sourceKind: 'au_document',
        patientId: session.patient_id,
        sessionId: session.id,
        documentKind: dto.documentKind,
        canonicalText: `${dto.documentKind}|${templateId}|${subject}`,
      });

      await recordScribeOutcomeTelemetry({
        clinicId: req.clinicId!,
        staffId: req.user!.id,
        patientId: session.patient_id,
        sessionId: session.id,
        telemetry: {
          event: 'au_document_draft_created',
          documentKind: dto.documentKind,
          latencyMs: Date.now() - startedAt,
          lineageKey: lineage.lineageKey,
        },
      });

      res.status(201).json(AuScribeDocumentResponseSchema.parse({
        schemaVersion: '1.0',
        documentKind: dto.documentKind,
        letterId: letter.id,
        templateId: letter.templateId,
        status: 'draft',
        sectionCount: letter.sections.length,
        lineage,
      }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/session/:id/style-feedback',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ScribeStyleFeedbackSchema.parse(req.body);
      const { session } = await requireSessionAccess(req, req.params.id);
      await requireActiveScribeConsent(req.clinicId!, session, 'Per-clinician style feedback');
      if (dto.patientId && dto.patientId !== session.patient_id) {
        return next(new AppError('Feedback patientId does not match session patient', 409, ErrorCode.CONFLICT));
      }

      const feedbackId = randomUUID();
      const editedLineage = buildScribeArtifactLineageKey({
        sourceKind: dto.source === 'au_document' ? 'au_document' : 'ambient_note',
        patientId: session.patient_id,
        sessionId: session.id,
        canonicalText: dto.editedText,
      });
      const longerTextLength = Math.max(dto.originalText.length, dto.editedText.length, 1);
      const editDistanceRatio = Math.min(
        1,
        Math.abs(dto.editedText.length - dto.originalText.length) / longerTextLength,
      );

      await recordScribeOutcomeTelemetry({
        clinicId: req.clinicId!,
        staffId: req.user!.id,
        patientId: session.patient_id,
        sessionId: session.id,
        telemetry: {
          event: 'feedback_submitted',
          clinicianSatisfaction: dto.rating,
          acceptedWithoutEdit: false,
          editDistanceRatio,
          lineageKey: editedLineage.lineageKey,
        },
      });

      res.status(201).json(ScribeStyleFeedbackResponseSchema.parse({
        schemaVersion: '1.0',
        feedbackId,
        styleLearningMode: 'derived-feedback-pending-adapter-consent',
        clinicianOptInConfirmed: true,
      }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/session/:id/outcome-telemetry',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ScribeOutcomeTelemetrySchema.parse(req.body);
      const { session } = await requireSessionAccess(req, req.params.id);
      await requireActiveScribeConsent(req.clinicId!, session, 'Scribe outcome telemetry');
      if (dto.patientId && dto.patientId !== session.patient_id) {
        return next(new AppError('Telemetry patientId does not match session patient', 409, ErrorCode.CONFLICT));
      }

      await recordScribeOutcomeTelemetry({
        clinicId: req.clinicId!,
        staffId: req.user!.id,
        patientId: session.patient_id,
        sessionId: session.id,
        telemetry: dto,
      });

      res.json(ScribeOutcomeTelemetryResponseSchema.parse({
        schemaVersion: '1.0',
        recorded: true,
        event: dto.event,
      }));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
