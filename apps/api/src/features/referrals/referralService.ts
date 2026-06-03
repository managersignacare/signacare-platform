import {
  CreateReferralDTO,
  OUTBOUND_REFERRAL_SOURCE,
  UpdateReferralDTO,
  ReferralDecisionDTO,
  ReferralListFilters,
  ReferralResponse,
  ReferralOcrFieldsSchema,
  ReferralOcrFields,
  type AuthContext,
} from '@signacare/shared';
import {
  referralRepository,
  ReferralDbRow,
} from './referralRepository';
import { enqueueOcrJob } from '../../queues/ocrQueue';
import { escapeLike } from '../../shared/escapeLike';
import { patientService } from '../patients/patientService';
import { patientRepository } from '../patients/patientRepository';
import { findDuplicateCandidates } from '../patients/duplicateDetection';
import { episodeService } from '../episode/episodeService';
import { db } from '../../db/db';
import auditLogService from '../../utils/audit';
import logger from '../../utils/logger';
import { AppError } from '../../shared/errors';
import { getActiveReferralModule } from './strategies/referralModuleStrategy';
import { soloStrategy } from './strategies/soloStrategy';
import { teamStrategy } from './strategies/teamStrategy';
import { buildDecisionReason, canonicalizeDecision } from './referralDecisionSupport';
import { mapReferralRowToResponse } from './referralResponseMapper';
import { referralFeedbackService } from './referralFeedbackService';
import { ensureCanonicalSpecialties } from '../../shared/ensureCanonicalSpecialties';
import { generateReferralNumber } from '../../shared/utils/numberGenerator';
function buildInternalAuthContext(clinicId: string, staffId: string): AuthContext {
  return {
    clinicId,
    staffId,
    role: 'clinician',
    permissions: [],
  };
}
function parseReceivedAt(dateOnly?: string): Date | undefined {
  if (!dateOnly) return undefined;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}
function resolveWorkflowDirection(params: {
  requestedDirection: CreateReferralDTO['direction'];
  requestedSource: string;
}): 'intake' | 'outbound' {
  if (params.requestedDirection === 'outbound') {
    return 'outbound';
  }
  if (
    params.requestedDirection === undefined &&
    params.requestedSource === OUTBOUND_REFERRAL_SOURCE
  ) {
    return 'outbound';
  }
  return 'intake';
}
async function assertClinicPatientExists(clinicId: string, patientId: string): Promise<void> {
  const patient = await patientRepository.findById(clinicId, patientId);
  if (!patient) {
    throw new AppError(
      'Selected patient does not exist in this clinic.',
      422,
      'REFERRAL_PATIENT_NOT_FOUND_IN_CLINIC',
      { patientId },
    );
  }
}
function buildDuplicateReviewDetails(
  candidates: Awaited<ReturnType<typeof findDuplicateCandidates>>,
): Array<{
  patientId: string;
  emrNumber: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  confidence: 'definite' | 'strong' | 'probable';
  score: number;
  matchedOn: string[];
}> {
  return candidates.slice(0, 5).map((candidate) => ({
    patientId: candidate.patient.id,
    emrNumber: candidate.patient.emr_number,
    givenName: candidate.patient.given_name,
    familyName: candidate.patient.family_name,
    dateOfBirth: candidate.patient.date_of_birth,
    confidence: candidate.confidence,
    score: candidate.score,
    matchedOn: candidate.matchedOn,
  }));
}
export class ReferralService {
  async createReferral(params: {
    clinicId: string;
    userId: string;
    dto: CreateReferralDTO;
  }): Promise<ReferralResponse> {
    const { clinicId, userId, dto } = params;
    await ensureCanonicalSpecialties({ caller: 'referralService.createReferral' });
    let patientId = dto.patientId ?? null;
    if (patientId) {
      await assertClinicPatientExists(clinicId, patientId);
    }
    if (!patientId && dto.patientGivenName && dto.patientFamilyName && dto.patientDob) {
      const candidates = await findDuplicateCandidates(clinicId, {
        givenName: dto.patientGivenName,
        familyName: dto.patientFamilyName,
        dateOfBirth: dto.patientDob,
        medicareNumber: dto.patientMedicareNumber,
        medicareIrn: dto.patientMedicareIrn,
        ihiNumber: dto.patientIhi,
        dvaNumber: dto.patientDvaNumber,
        phoneMobile: dto.patientPhone,
      });
      if (candidates.length > 0) {
        throw new AppError(
          'Potential existing patient matches found. Select an existing patient before creating this referral.',
          409,
          'REFERRAL_PATIENT_MATCH_REVIEW_REQUIRED',
          { candidates: buildDuplicateReviewDetails(candidates) },
        );
      }
      const quickPatient = await patientService.quickRegister(
        { staffId: userId, clinicId, role: 'clinician', permissions: ['patient:create'] },
        {
          givenName: dto.patientGivenName,
          familyName: dto.patientFamilyName,
          dateOfBirth: dto.patientDob,
          phoneMobile: dto.patientPhone,
          medicareNumber: dto.patientMedicareNumber,
          medicareIrn: dto.patientMedicareIrn,
          ihi: dto.patientIhi,
          dvaNumber: dto.patientDvaNumber,
        },
      );
      patientId = quickPatient.id;
    }
    if (!patientId) {
      throw new AppError(
        'Cannot create referral: patientId is required (provide patientId or patientGivenName + patientFamilyName + patientDob for quick registration)',
        422,
        'PATIENT_REQUIRED',
      );
    }
    const referralNumber = await generateReferralNumber(clinicId);
    const status = 'received';
    const requestedDirection = dto.direction;
    const requestedSource = (dto.source ?? '').trim();
    const workflowDirection = resolveWorkflowDirection({
      requestedDirection,
      requestedSource,
    });
    let source = requestedSource.length > 0 ? requestedSource : 'external';
    if (workflowDirection === 'outbound') {
      source = OUTBOUND_REFERRAL_SOURCE;
    } else if (source === OUTBOUND_REFERRAL_SOURCE) {
      source = 'internal';
    }
    const targetSpecialty = dto.targetSpecialty ?? 'mental_health';
    let coordinatorCount = 0;
    if (workflowDirection === 'outbound') {
      coordinatorCount = await referralRepository.countCoordinatorsForSpecialty(
        clinicId,
        targetSpecialty,
      );
    }
    const taskStatus =
      workflowDirection === 'outbound' && coordinatorCount > 0
        ? 'requested'
        : 'received';
    const row: Partial<ReferralDbRow> = {
      clinic_id: clinicId,
      patient_id: patientId,
      referral_number: referralNumber,
      referral_date: dto.referralDate,
      received_at: parseReceivedAt(dto.receivedDate),
      source,
      from_service: dto.fromService ?? 'Unknown',
      from_provider_name: dto.fromProviderName ?? null,
      from_provider_phone: dto.fromProviderPhone ?? null,
      from_provider_email: dto.fromProviderEmail ?? null,
      referring_org: dto.referringOrg ?? null,
      reason: dto.reason ?? '',
      clinical_summary: dto.clinicalSummary ?? null,
      current_medications: dto.currentMedications ?? null,
      diagnosis_info: dto.diagnosisInfo ?? null,
      urgency: dto.urgency,
      status,
      assigned_to_staff_id: dto.assignedToStaffId ?? null,
      sla_due_date: dto.slaDueDate ?? null,
      internal_notes: dto.notes ?? null,
      rejection_reason: null,
      target_specialty_code: targetSpecialty,
      service_request_status: 'active',
      task_status: taskStatus,
    };
    const created = await referralRepository.createReferral(row);
    const { db: dbConn } = await import('../../db/db');
    try {
      await dbConn('referral_state_transitions').insert({
        clinic_id: clinicId,
        referral_id: created.id,
        from_task_status: null,
        to_task_status: taskStatus,
        actor_id: userId,
        reason:
          workflowDirection === 'intake'
            ? 'Created — intake received'
            : coordinatorCount > 0
              ? 'Created — awaiting coordinator triage'
              : 'Created — auto-degraded (no coordinator)',
        created_at: new Date(),
      });
    } catch (err) {
      logger.warn({ err, referralId: created.id }, 'referral_state_transitions seed failed — continuing');
    }
    if (patientId && workflowDirection === 'intake') {
      try {
        const targetName = (dto.fromService ?? '').trim();
        const dateStr = dto.referralDate.replace(/-/g, '');
        const shortTarget = targetName.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20) || 'external';
        const episodeTitle = `referral-${shortTarget}-${dateStr}`;
        const referralEp = await episodeService.create(buildInternalAuthContext(clinicId, userId), {
          patientId,
          title: episodeTitle,
          episodeType: 'referral',
          startDate: dto.referralDate,
        });
        const targetUnit = targetName ? await dbConn('org_units').where({ clinic_id: clinicId }).whereRaw('name ILIKE ?', [`%${escapeLike(targetName)}%`]).first() : null;
        if (targetUnit) {
          await dbConn('episodes').where({ id: referralEp.id }).update({ team_id: targetUnit.id });
        }
        await referralRepository.updateReferral(clinicId, created.id, { linked_episode_id: referralEp.id });
        created.linked_episode_id = referralEp.id;
      } catch (err) {
        logger.warn({ err, referralId: created.id }, 'referral episode creation failed — continuing without episode link');
      }
    }
    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId: created.id,
      eventType: 'received',
      performedByStaffId: userId,
      notes: 'Referral received',
    });
    if (workflowDirection === 'intake') {
      try {
        await referralFeedbackService.sendIntakeAcknowledgement(
          buildInternalAuthContext(clinicId, userId),
          created.id,
        );
      } catch (err) {
        logger.warn({ err, clinicId, referralId: created.id }, 'Failed to send intake acknowledgement');
      }
    }
    await auditLogService.logCreate({
      clinicId,
      userId,
      tableName: 'referrals',
      recordId: created.id,
      newData: created,
    });
    if (workflowDirection === 'outbound') {
      try {
        const activeModule = await getActiveReferralModule(clinicId);
        if (activeModule === 'solo') {
          await soloStrategy.onReferralCreated({
            clinicId, userId, referralId: created.id, referral: created, dto,
          });
        } else if (activeModule === 'team') {
          await teamStrategy.onReferralCreated({
            clinicId, userId, referralId: created.id, referral: created, dto,
          });
        }
      } catch (err) {
        logger.warn({ err, clinicId, referralId: created.id }, 'Module strategy onReferralCreated failed — referral created with standard workflow');
      }
    }
    const updated = await referralRepository.findById(clinicId, created.id);
    const attachments = await referralRepository.listAttachments(clinicId, created.id);
    return mapReferralRowToResponse(updated ?? created, attachments);
  }
  async updateReferral(params: {
    clinicId: string;
    userId: string;
    referralId: string;
    dto: UpdateReferralDTO;
  }): Promise<ReferralResponse | null> {
    const { clinicId, userId, referralId, dto } = params;
    const existing = await referralRepository.findById(clinicId, referralId);
    if (!existing) return null;
    const patch: Partial<ReferralDbRow> = {
      reason: dto.reason ?? existing.reason,
      urgency: dto.urgency ?? (existing.urgency as string),
      internal_notes: dto.notes ?? existing.internal_notes,
      assigned_to_staff_id: dto.assignedToStaffId ?? existing.assigned_to_staff_id,
      sla_due_date: dto.slaDueDate ?? existing.sla_due_date,
    };
    if (dto.status && dto.status !== existing.status) {
      patch.status = dto.status as string;
      patch.status_changed_at = new Date();
    }
    const updated = await referralRepository.updateReferral(clinicId, referralId, patch);
    if (!updated) return null;
    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'reviewed',
      performedByStaffId: userId,
      notes: 'Referral updated',
    });
    await auditLogService.logUpdate({
      clinicId,
      userId,
      tableName: 'referrals',
      recordId: referralId,
      oldData: existing,
      newData: updated,
    });
    const attachments = await referralRepository.listAttachments(clinicId, referralId);
    return mapReferralRowToResponse(updated, attachments);
  }
  async getById(params: {
    clinicId: string;
    referralId: string;
  }): Promise<ReferralResponse | null> {
    const { clinicId, referralId } = params;
    const row = await referralRepository.findById(clinicId, referralId);
    if (!row) return null;
    const attachments = await referralRepository.listAttachments(clinicId, referralId);
    return mapReferralRowToResponse(row, attachments);
  }
  async list(params: {
    clinicId: string;
    filters: ReferralListFilters;
  }): Promise<{ items: ReferralResponse[]; total: number }> {
    const { clinicId, filters } = params;
    const { rows, total } = await referralRepository.list(clinicId, filters);
    const items: ReferralResponse[] = [];
    for (const row of rows) {
      const attachments = await referralRepository.listAttachments(clinicId, row.id);
      items.push(mapReferralRowToResponse(row, attachments));
    }
    return { items, total };
  }
  async decideReferral(params: {
    clinicId: string;
    userId: string;
    referralId: string;
    dto: ReferralDecisionDTO;
  }): Promise<ReferralResponse | null> {
    const { clinicId, userId, referralId, dto } = params;
    const existing = await referralRepository.findById(clinicId, referralId);
    if (!existing) return null;
    const canonicalDecision = canonicalizeDecision(dto.decision);
    const normalizedDto: ReferralDecisionDTO = {
      ...dto,
      decision: canonicalDecision,
      rejectionReason: dto.rejectionReason ?? dto.declineReason ?? undefined,
    };
    const currentStatus = (existing.status ?? '').toString().toLowerCase();
    const TERMINAL_STATES = new Set([
      'accepted',
      'appointment_booked',
      'rejected',
      'redirected',
      'closed_no_response',
      'expired',
      'completed',
      'closed',
    ]);
    if (TERMINAL_STATES.has(currentStatus)) {
      throw new AppError(
        `Referral is already ${currentStatus}. Terminal referral states cannot be re-decided — create a new referral if reconsideration is needed.`,
        422,
        'INVALID_STATE_TRANSITION',
      );
    }
    const currentTaskStatus = (existing.task_status ?? '').toString().toLowerCase();
    const TERMINAL_TASK_STATES = new Set(['accepted', 'rejected', 'completed']);
    if ((canonicalDecision === 'accepted' || canonicalDecision === 'rejected') && TERMINAL_TASK_STATES.has(currentTaskStatus)) {
      throw new AppError(
        `Referral task is already terminal (${currentTaskStatus}). Re-decision is not allowed.`,
        409,
        'INVALID_STATE_TRANSITION',
      );
    }
    if ((canonicalDecision === 'accepted' || canonicalDecision === 'rejected') && dto.confirmDecision !== true) {
      throw new AppError(
        'Decision confirmation missing. Submit confirmDecision=true to apply accept/decline.',
        422,
        'DECISION_CONFIRMATION_REQUIRED',
      );
    }
    if (canonicalDecision === 'rejected' && !buildDecisionReason(normalizedDto)) {
      throw new AppError('Decline reason is required.', 422, 'VALIDATION_ERROR');
    }
    if (
      dto.patientId &&
      existing.patient_id &&
      dto.patientId !== existing.patient_id
    ) {
      throw new AppError(
        'Referral is already linked to a patient. Re-linking must go through a dedicated merge/correction workflow.',
        409,
        'REFERRAL_PATIENT_RELINK_FORBIDDEN',
        {
          existingPatientId: existing.patient_id,
          requestedPatientId: dto.patientId,
        },
      );
    }
    const patientId = dto.patientId ?? existing.patient_id;
    if (patientId) {
      await assertClinicPatientExists(clinicId, patientId);
    }
    if (!patientId) {
      logger.warn(
        { clinicId, referralId },
        'Referral decision attempted without patient; manual registration required.',
      );
    }
    let episodeId = existing.linked_episode_id;
    const referralMode = existing.referral_mode;
    const isModuleMode = referralMode === 'solo' || referralMode === 'team';
    const status: string = canonicalDecision;
    const { todayLocal } = await import('../../utils/dateUtils');
    const today = todayLocal();
    if (canonicalDecision === 'accepted' && patientId && !dto.isExternalTarget) {
      try {
        const careEpisode = await episodeService.create(buildInternalAuthContext(clinicId, userId), {
          patientId,
          title: dto.episodeType ? `${dto.episodeType} Care Episode` : 'Care Episode',
          episodeType: dto.episodeType ?? 'community',
          startDate: today,
        });
        episodeId = careEpisode.id;
      } catch (err) {
        logger.error({ err, clinicId, referralId, patientId }, 'Failed to open care episode — aborting referral acceptance');
        throw new Error('Unable to open care episode in target team. Referral remains open.');
      }
    }
    const shouldCloseIntake =
      (canonicalDecision === 'rejected') ||
      (canonicalDecision === 'accepted' && dto.isExternalTarget) ||
      (
        canonicalDecision === 'accepted'
        && !dto.isExternalTarget
        && !!patientId
        && !isModuleMode
      );
    if (shouldCloseIntake && existing.linked_episode_id) {
      try {
        const reason = canonicalDecision === 'rejected'
          ? 'Referral rejected'
          : dto.isExternalTarget
            ? 'Referral accepted — referred to external provider'
            : 'Referral accepted — moved to ongoing care episode';
        const closureSummary = canonicalDecision === 'rejected'
          ? ((dto.notes ?? '').trim().length >= 10
            ? String(dto.notes).trim()
            : 'Referral rejected during intake review.')
          : dto.isExternalTarget
            ? 'Referral accepted to an external provider; intake episode closed.'
            : `Referral accepted and ongoing care episode ${episodeId ?? 'opened'} created; intake episode closed automatically.`;
        await episodeService.close(buildInternalAuthContext(clinicId, userId), existing.linked_episode_id, {
          endDate: today,
          closureReason: reason,
          dischargeSummary: closureSummary,
        });
      } catch (err) {
        logger.warn({ err, clinicId, referralId }, 'Failed to close intake episode on referral decision');
      }
    }
    if (referralMode === 'solo' || referralMode === 'team') {
      const strategy = referralMode === 'solo' ? soloStrategy : teamStrategy;
      await strategy.onDecision({
        clinicId, userId, referralId, referral: existing, dto: normalizedDto,
      });
      const refreshed = await referralRepository.findById(clinicId, referralId);
      if (!refreshed) return null;
      const attachments = await referralRepository.listAttachments(clinicId, referralId);
      return mapReferralRowToResponse(refreshed, attachments);
    }
    const nextTaskStatus = canonicalDecision === 'accepted'
      ? 'accepted'
      : canonicalDecision === 'rejected'
        ? 'rejected'
        : existing.task_status;
    const decisionReason = buildDecisionReason(normalizedDto);
    const patch: Partial<ReferralDbRow> = {
      patient_id: patientId ?? existing.patient_id,
      linked_episode_id: episodeId,
      status,
      status_changed_at: new Date(),
      task_status: nextTaskStatus,
      rejection_reason: canonicalDecision === 'rejected' ? decisionReason : null,
      assigned_to_staff_id: dto.assignedToStaffId ?? existing.assigned_to_staff_id,
    };
    const updated = await referralRepository.updateReferral(clinicId, referralId, patch);
    if (!updated) return null;
    if ((existing.task_status ?? '') !== nextTaskStatus) {
      await db('referral_state_transitions').insert({
        clinic_id: clinicId,
        referral_id: referralId,
        from_task_status: existing.task_status,
        to_task_status: nextTaskStatus,
        actor_id: userId,
        reason: decisionReason,
        created_at: new Date(),
      });
    }
    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'decision',
      performedByStaffId: userId,
      notes: dto.notes ?? undefined,
      outcome: canonicalDecision,
    });
    if (episodeId) {
      await referralRepository.insertWorkflowEvent({
        clinicId,
        referralId,
        eventType: 'episode_opened',
        performedByStaffId: userId,
        notes: `Episode ${episodeId} opened from referral`,
      });
    }
    await auditLogService.logUpdate({
      clinicId,
      userId,
      tableName: 'referrals',
      recordId: referralId,
      oldData: existing,
      newData: updated,
    });
    const attachments = await referralRepository.listAttachments(clinicId, referralId);
    return mapReferralRowToResponse(updated, attachments);
  }
  async uploadAttachment(params: {
    clinicId: string;
    userId: string;
    referralId: string;
    file: {
      originalname: string;
      filename: string;
      mimetype: string;
      size: number;
      storageKey: string;
    };
  }): Promise<ReferralResponse | null> {
    const { clinicId, userId, referralId, file } = params;
    const referral = await referralRepository.findById(clinicId, referralId);
    if (!referral) return null;
    const attachment = await referralRepository.createAttachment({
      clinic_id: clinicId,
      referral_id: referralId,
      original_filename: file.originalname,
      stored_filename: file.filename,
      mime_type: file.mimetype,
      file_size_bytes: file.size,
      storage_key: file.storageKey,
      category: 'referral',
      ocr_status: 'pending',
      ocr_result: null,
      ocr_error_message: null,
    });
    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'ocr_started',
      performedByStaffId: userId,
      notes: 'OCR job enqueued',
    });
    await enqueueOcrJob({
      clinicId,
      referralId,
      attachmentId: attachment.id,
      storageKey: attachment.storage_key,
      mimeType: attachment.mime_type,
    });
    await auditLogService.logCreate({
      clinicId,
      userId,
      tableName: 'referral_attachments',
      recordId: attachment.id,
      newData: attachment,
    });
    const updated = await referralRepository.findById(clinicId, referralId);
    if (!updated) return null;
    const attachments = await referralRepository.listAttachments(clinicId, referralId);
    return mapReferralRowToResponse(updated, attachments);
  }
  async getOcrPreview(params: {
    clinicId: string;
    referralId: string;
  }): Promise<unknown | null> {
    const { clinicId, referralId } = params;
    const referral = await referralRepository.findById(clinicId, referralId);
    if (!referral) return null;
    return referral.ocr_extracted;
  }
  async confirmOcrData(params: {
    clinicId: string;
    userId: string;
    referralId: string;
    data: unknown;
  }): Promise<ReferralResponse | null> {
    const { clinicId, userId, referralId, data } = params;
    const existing = await referralRepository.findById(clinicId, referralId);
    if (!existing) return null;
    const updated = await referralRepository.updateReferral(clinicId, referralId, {
      ocr_extracted: data,
      status:
        existing.status === 'awaiting_clinician_confirmation'
          ? ('under_review' as string)
          : existing.status,
      status_changed_at: new Date(),
    });
    if (!updated) return null;
    await referralRepository.insertWorkflowEvent({
      clinicId,
      referralId,
      eventType: 'ocr_completed',
      performedByStaffId: userId,
      notes: 'OCR data confirmed by clinician',
    });
    await auditLogService.logUpdate({
      clinicId,
      userId,
      tableName: 'referrals',
      recordId: referralId,
      oldData: existing,
      newData: updated,
    });
    const attachments = await referralRepository.listAttachments(clinicId, referralId);
    return mapReferralRowToResponse(updated, attachments);
  }
  async getOcrFields(params: {
    clinicId: string;
    referralId: string;
  }): Promise<ReferralOcrFields | null> {
    const { clinicId, referralId } = params;
    const referral = await referralRepository.findById(clinicId, referralId);
    if (!referral || !referral.ocr_extracted) return null;
    interface OcrDataShape {
      fields?: {
        patientName?: string | null;
        givenName?: string | null;
        familyName?: string | null;
        dob?: string | null;
        medicareNumber?: string | null;
        referrerName?: string | null;
        reason?: string | null;
      };
      rawText?: string | null;
    }
    const raw = referral.ocr_extracted as OcrDataShape | Record<string, unknown> | null;
    const hasStructuredFields = raw != null && typeof raw === 'object' && ('fields' in raw || 'rawText' in raw);
    const source = hasStructuredFields
      ? (() => {
          const typedRaw = raw as OcrDataShape;
          return {
            patientName: typedRaw.fields?.patientName ?? null,
            givenName: typedRaw.fields?.givenName ?? null,
            familyName: typedRaw.fields?.familyName ?? null,
            dob: typedRaw.fields?.dob ?? null,
            medicareNumber: typedRaw.fields?.medicareNumber ?? null,
            referrerName: typedRaw.fields?.referrerName ?? null,
            reason: typedRaw.fields?.reason ?? null,
            fullText: typedRaw.rawText ?? null,
          };
        })()
      : raw;
    return ReferralOcrFieldsSchema.parse(source);
  }
}
export const referralService = new ReferralService();
