import type { AuthContext, CreateNoteDTO, UpdateNoteDTO } from '@signacare/shared';
import { RECENT_RISK_ASSESSMENT_WINDOW_HOURS } from '@signacare/shared';
import { clinicalNoteRepository } from './clinicalNote.repository';
import type { ClinicalNoteRow } from './clinicalNote.repository';
import { createAutoContactRecord } from '../contacts/autoContactRecord';
import { AppError } from '../../shared/errors';
import {
  requireClinicalAccessRole,
  requirePatientReadAccess,
  requirePatientRelationship,
  requirePermissionOrClinicalLeadershipOverride,
} from '../../shared/authGuards';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { shouldEnforceAiDraftSignAttestation } from '../../shared/aiDraftSignAttestationPolicy';
import { evaluateRecentRiskAssessmentSignGate } from '../../shared/recentRiskAssessmentGate';

/**
 * S5.4 — Capture a clinical_note_versions snapshot of the CURRENT row
 * before a mutation is applied. Errors are logged but never thrown —
 * the user's clinical work cannot be blocked by a non-essential ledger.
 *
 * Phase R R3c — clinical_note_versions is a first-class baseline table
 * (R2b) with a JSONB `snapshot` column that captures the full pre-edit
 * state plus `edited_by_staff_id` / `edit_reason` / `status_at_snapshot`.
 * Pre-R2 the service wrote to per-field columns (content, soap_*, status)
 * that did not exist — every snapshot silently failed. The hasTable
 * guard has also been removed; the baseline owns the schema.
 */
async function snapshotNoteVersion(
  existing: ClinicalNoteRow,
  editedByStaffId: string,
  reason: string,
): Promise<void> {
  try {
    await db('clinical_note_versions').insert({
      note_id: existing.id,
      clinic_id: existing.clinicId,
      version_number: db.raw(
        `(SELECT COALESCE(MAX(version_number), 0) + 1 FROM clinical_note_versions WHERE note_id = ?)`,
        [existing.id],
      ),
      snapshot: JSON.stringify({
        content: existing.content,
        soapSubjective: existing.soapSubjective,
        soapObjective: existing.soapObjective,
        soapAssessment: existing.soapAssessment,
        soapPlan: existing.soapPlan,
      }),
      edited_by_staff_id: editedByStaffId,
      edit_reason: reason,
      status_at_snapshot: existing.status,
    });
  } catch (err) {
    logger.warn(
      { err, noteId: existing.id, editedByStaffId },
      'snapshotNoteVersion: failed to write clinical_note_versions row (mutation will still proceed)',
    );
  }
}

export const clinicalNoteService = {
  async listByPatient(
    auth: AuthContext,
    patientId: string,
    episodeId?: string,
  ): Promise<ClinicalNoteRow[]> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:read');
    await requirePatientReadAccess(auth, patientId);
    return clinicalNoteRepository.listByPatient(auth.clinicId, patientId, episodeId);
  },

  async getById(auth: AuthContext, id: string): Promise<ClinicalNoteRow> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:read');
    const note = await clinicalNoteRepository.findById(auth.clinicId, id);
    if (!note) throw new AppError('Note not found', 404, 'NOTE_NOT_FOUND');
    await requirePatientReadAccess(auth, note.patientId);
    return note;
  },

  async create(auth: AuthContext, dto: CreateNoteDTO): Promise<ClinicalNoteRow> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:create');
    await requirePatientRelationship(auth, dto.patientId);
    let resolvedEpisodeId = dto.episodeId;
    if (!resolvedEpisodeId && dto.patientId) {
      const activeEp = await db('episodes')
        .where({ patient_id: dto.patientId, clinic_id: auth.clinicId, status: 'open' })
        .whereNull('deleted_at')
        .orderBy('created_at', 'desc')
        .first();
      resolvedEpisodeId = activeEp?.id;
    }
    const note = await clinicalNoteRepository.create(auth.clinicId, auth.staffId, {
      patientId:      dto.patientId,
      episodeId:      resolvedEpisodeId,
      noteType:       dto.noteType ?? 'soap',
      noteDateTime:   dto.noteDateTime,
      content:        dto.content,
      soapSubjective: dto.soapSubjective,
      soapObjective:  dto.soapObjective,
      soapAssessment: dto.soapAssessment,
      soapPlan:       dto.soapPlan,
      templateId:     dto.templateId,
      isAiDraft:      dto.isAiDraft ?? false,
      amendedFromId:  dto.amendedFromId,
      consentId:      dto.consentId,
    });

    try {
      await createAutoContactRecord({
        clinicId: auth.clinicId,
        patientId: dto.patientId,
        episodeId: dto.episodeId,
        staffId: auth.staffId,
        sourceType: 'clinical_note',
        sourceId: note.id,
        briefSummary: dto.noteType ? `${dto.noteType} note` : undefined,
      });
    } catch (_contactErr) {
      // intentional silent — auto-contact is non-blocking; failures are
      // already logged inside createAutoContactRecord.
      void _contactErr;
    }

    // BUG-369 — HIPAA §164.312(b) forensic audit trail. Separate from
    // clinical_note_versions (the restore ledger). writeAuditLog never
    // throws and is PHI-metadata-only (no raw note body).
    await writeAuditLog({
      clinicId: auth.clinicId,
      actorId: auth.staffId,
      tableName: 'clinical_notes',
      recordId: note.id,
      action: 'NOTE_CREATE',
      newData: {
        patientId: dto.patientId,
        episodeId: resolvedEpisodeId ?? null,
        noteType: dto.noteType ?? 'soap',
        templateId: dto.templateId ?? null,
        isAiDraft: dto.isAiDraft ?? false,
      },
    });

    return note;
  },

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateNoteDTO,
    expectedLockVersion?: number,
  ): Promise<ClinicalNoteRow> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:create');
    const existing = await clinicalNoteRepository.findById(auth.clinicId, id);
    if (!existing) throw new AppError('Note not found', 404, 'NOTE_NOT_FOUND');
    await requirePatientRelationship(auth, existing.patientId);
    if (existing.status === 'signed') throw new AppError('Signed notes cannot be edited', 409, 'NOTE_SIGNED');
    // Author check: only the author or admin/superadmin can edit a draft
    if (existing.authorId !== auth.staffId && !['admin', 'superadmin'].includes(auth.role)) {
      throw new AppError('Only the note author can edit this draft', 403, 'NOT_AUTHOR');
    }
    await snapshotNoteVersion(existing, auth.staffId, 'update');
    const updated = await clinicalNoteRepository.update(
      auth.clinicId,
      id,
      {
        noteType:       dto.noteType,
        noteDateTime:   dto.noteDateTime,
        content:        dto.content,
        soapSubjective: dto.soapSubjective,
        soapObjective:  dto.soapObjective,
        soapAssessment: dto.soapAssessment,
        soapPlan:       dto.soapPlan,
        templateId:     dto.templateId,
        isAiDraft:      dto.isAiDraft,
      },
      expectedLockVersion,
    );

    // BUG-369 — forensic audit trail. old_data is the lock_version for
    // change-detection; no raw note body.
    await writeAuditLog({
      clinicId: auth.clinicId,
      actorId: auth.staffId,
      tableName: 'clinical_notes',
      recordId: id,
      action: 'NOTE_UPDATE',
      oldData: { lockVersion: existing.lockVersion, status: existing.status },
      newData: {
        lockVersion: updated.lockVersion,
        fieldsChanged: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
      },
    });

    return updated;
  },

  async sign(auth: AuthContext, id: string, opts: { reviewedAndAdopted?: boolean } = {}): Promise<ClinicalNoteRow> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:create');
    const existing = await clinicalNoteRepository.findById(auth.clinicId, id);
    if (!existing) throw new AppError('Note not found', 404, 'NOTE_NOT_FOUND');
    await requirePatientRelationship(auth, existing.patientId);
    if (existing.status === 'signed') throw new AppError('Note already signed', 409, 'NOTE_ALREADY_SIGNED');
    const enforceAiDraftAttestation = await shouldEnforceAiDraftSignAttestation(auth);

    // Audit Tier 5.8 (HIGH-G1) — cross-clinician scribe signing safeguard.
    // When the signer is NOT the original author, require the explicit
    // "reviewed and adopted" attestation to travel through the sign
    // request. This prevents one clinician accepting another's AI-
    // drafted or scribe-captured note without attesting they've
    // reviewed and taken clinical responsibility for it.
    const authorId = existing.authorId ?? (existing as { author_id?: string | null }).author_id ?? null;
    const isCrossAuthor = !!authorId && authorId !== auth.staffId;
    const isAiDraft = existing.isAiDraft === true;
    const requiresReviewedAndAdopted = enforceAiDraftAttestation && (isCrossAuthor || isAiDraft);
    if (requiresReviewedAndAdopted && !opts.reviewedAndAdopted) {
      throw new AppError(
        isCrossAuthor
          ? 'This note was authored by another clinician. Use the "Review and adopt" flow to attest you have reviewed and adopted the content before signing.'
          : 'This AI-drafted note requires explicit review and adoption attestation before signing.',
        409,
        'REVIEW_AND_ADOPT_REQUIRED',
      );
    }
    const recentRiskGate = await evaluateRecentRiskAssessmentSignGate({
      dbConn: db,
      auth,
      patientId: existing.patientId,
      noteType: existing.noteType,
      isSigning: true,
      currentNoteId: id,
    });
    if (
      recentRiskGate.requiresRecentRiskAssessment &&
      !recentRiskGate.hasRecentRiskAssessment
    ) {
      throw new AppError(
        `A risk assessment completed within the last ${RECENT_RISK_ASSESSMENT_WINDOW_HOURS} hours is required before signing this first psychiatric note for a new patient.`,
        409,
        'RECENT_RISK_ASSESSMENT_REQUIRED',
      );
    }

    await snapshotNoteVersion(existing, auth.staffId, 'sign');
    const markReviewedAndAdopted = requiresReviewedAndAdopted && opts.reviewedAndAdopted === true;
    const signed = await clinicalNoteRepository.sign(auth.clinicId, id, auth.staffId, {
      markReviewedAndAdopted,
    });

    // BUG-369 — forensic audit trail. Sign is the legally-significant
    // transition: signing produces a clinical attestation.
    //
    // L4-absorb 2026-04-24 — cross-author sign uses the
    // `NOTE_CROSS_AUTHOR_SIGN` literal so AHPRA / coronial review can
    // query the first-class action, not a JSON-field filter. The
    // `reviewedAndAdopted` boolean remains in `new_data` for payload
    // context but the search primitive is the action literal itself.
    await writeAuditLog({
      clinicId: auth.clinicId,
      actorId: auth.staffId,
      tableName: 'clinical_notes',
      recordId: id,
      action: isCrossAuthor ? 'NOTE_CROSS_AUTHOR_SIGN' : 'NOTE_SIGN',
      oldData: { status: existing.status, authorId },
      newData: {
        status: 'signed',
        signedByStaffId: auth.staffId,
        isCrossAuthor,
        isAiDraft,
        reviewedAndAdopted: markReviewedAndAdopted ? true : undefined,
      },
    });

    return signed;
  },

  async amend(auth: AuthContext, id: string, dto: CreateNoteDTO): Promise<ClinicalNoteRow> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:create');
    const original = await clinicalNoteRepository.findById(auth.clinicId, id);
    if (!original) throw new AppError('Note not found', 404, 'NOTE_NOT_FOUND');
    await requirePatientRelationship(auth, original.patientId);
    if (original.status !== 'signed') throw new AppError('Only signed notes can be amended', 409, 'NOTE_NOT_SIGNED');
    await snapshotNoteVersion(original, auth.staffId, 'amend');
    // Signed note payload is immutable; amendments are represented as
    // a linked child note via amendedFromId.
    const amended = await clinicalNoteRepository.create(auth.clinicId, auth.staffId, {
      ...dto,
      amendedFromId: id,
      isAiDraft: false,
    });

    // BUG-369 — forensic audit on BOTH the original (marked amended)
    // and the new amendment note, so a reviewer can walk either side.
    // record_id = original note id on the primary row; the amendment's
    // own NOTE_CREATE audit comes from the nested create() call above.
    await writeAuditLog({
      clinicId: auth.clinicId,
      actorId: auth.staffId,
      tableName: 'clinical_notes',
      recordId: id,
      action: 'NOTE_AMEND',
      oldData: { status: original.status, noteType: original.noteType },
      newData: { amendedByNoteId: amended.id, originalNoteType: original.noteType },
    });

    return amended;
  },

  async softDelete(auth: AuthContext, id: string): Promise<void> {
    requireClinicalAccessRole(auth);
    await requirePermissionOrClinicalLeadershipOverride(auth, 'note:create');
    const existing = await clinicalNoteRepository.findById(auth.clinicId, id);
    if (!existing) throw new AppError('Note not found', 404, 'NOTE_NOT_FOUND');
    await requirePatientRelationship(auth, existing.patientId);
    if (existing.status === 'signed') throw new AppError('Signed notes cannot be deleted', 409, 'NOTE_SIGNED');
    await clinicalNoteRepository.softDelete(auth.clinicId, id);

    // BUG-369 — forensic audit row on soft-delete. Distinct from
    // NOTE_UPDATE so a reviewer can query deleted-note history directly.
    await writeAuditLog({
      clinicId: auth.clinicId,
      actorId: auth.staffId,
      tableName: 'clinical_notes',
      recordId: id,
      action: 'NOTE_SOFT_DELETE',
      oldData: {
        status: existing.status,
        patientId: existing.patientId,
        episodeId: existing.episodeId ?? null,
      },
    });
  },
};
