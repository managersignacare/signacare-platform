import type { Knex } from 'knex';
import { db } from '../../db/db';
import { ensureClinicalNoteConsent } from '../../shared/recordingConsent';

export interface ClinicalNoteRow {
  id:               string;
  clinicId:         string;
  patientId:        string;
  episodeId:        string | null;
  appointmentId:    string | null;
  authorId:         string;
  authorName:       string;
  noteType:         string;
  status:           string;
  noteDateTime:     string;
  content:          string;
  soapSubjective:   string | null;
  soapObjective:    string | null;
  soapAssessment:   string | null;
  soapPlan:         string | null;
  templateId:       string | null;
  isAiDraft:        boolean;
  amendedFromId:    string | null;
  signedAt:         string | null;
  signedById:       string | null;
  createdAt:        string;
  updatedAt:        string;
  lockVersion:      number;
}

const SELECT_COLS = [
  'n.id',
  'n.clinic_id         as clinicId',
  'n.patient_id        as patientId',
  'n.episode_id        as episodeId',
  'n.appointment_id    as appointmentId',
  'n.author_id         as authorId',
  db.raw(`concat(staff.given_name, ' ', staff.family_name) as "authorName"`),
  'n.note_type         as noteType',
  'n.status',
  'n.note_date_time    as noteDateTime',
  'n.content',
  'n.soap_subjective   as soapSubjective',
  'n.soap_objective    as soapObjective',
  'n.soap_assessment   as soapAssessment',
  'n.soap_plan         as soapPlan',
  'n.template_id       as templateId',
  'n.is_ai_draft       as isAiDraft',
  'n.amended_from_id   as amendedFromId',
  'n.signed_at         as signedAt',
  'n.signed_by_id      as signedById',
  'n.created_at        as createdAt',
  'n.updated_at        as updatedAt',
  'n.structured_fields as structuredFields',
  'n.lock_version      as lockVersion',
];

function base(trx?: Knex.Transaction) {
  return (trx ?? db)('clinical_notes as n')
    .join('staff', 'staff.id', 'n.author_id')
    .whereNull('n.deleted_at')
    .select(SELECT_COLS);
}

export const clinicalNoteRepository = {
  async listByPatient(
    clinicId: string,
    patientId: string,
    episodeId?: string,
  ): Promise<ClinicalNoteRow[]> {
    const q = base().where({ 'n.clinic_id': clinicId, 'n.patient_id': patientId });
    if (episodeId) q.where('n.episode_id', episodeId);
    return q.orderBy('n.note_date_time', 'desc');
  },

  async findById(clinicId: string, id: string): Promise<ClinicalNoteRow | undefined> {
    return base().where({ 'n.id': id, 'n.clinic_id': clinicId }).first();
  },

  async create(
    clinicId: string,
    authorId: string,
    data: {
      patientId:      string;
      episodeId?:     string;
      appointmentId?: string;
      noteType:       string;
      noteDateTime:   string;
      content:        string;
      soapSubjective?: string;
      soapObjective?:  string;
      soapAssessment?: string;
      soapPlan?:       string;
      templateId?:     string;
      isAiDraft:       boolean;
      amendedFromId?:  string;
      contactMeta?:    Record<string, unknown>;
      isReportableContact?: boolean;
      didNotAttend?:   boolean;
      status?:         string;
      consentId?:      string;
    },
  ): Promise<ClinicalNoteRow> {
    const consentId = await ensureClinicalNoteConsent({
      clinicId,
      patientId: data.patientId,
      clinicianId: authorId,
      consentId: data.consentId,
    });

    const [row] = await db('clinical_notes')
      .insert({
        clinic_id:        clinicId,
        patient_id:       data.patientId,
        consent_id:       consentId,
        episode_id:       data.episodeId ?? null,
        appointment_id:   data.appointmentId ?? null,
        author_id:        authorId,
        note_type:        data.noteType,
        status:           data.status ?? 'draft',
        note_date_time:   data.noteDateTime,
        content:          data.content,
        soap_subjective:  data.soapSubjective ?? null,
        soap_objective:   data.soapObjective  ?? null,
        soap_assessment:  data.soapAssessment ?? null,
        soap_plan:        data.soapPlan       ?? null,
        template_id:      data.templateId     ?? null,
        is_ai_draft:      data.isAiDraft,
        amended_from_id:  data.amendedFromId  ?? null,
        structured_fields: data.contactMeta ? JSON.stringify({ contactMeta: data.contactMeta, isReportableContact: data.isReportableContact ?? true, didNotAttend: data.didNotAttend ?? false }) : null,
        updated_at:       db.fn.now(),
      })
      .returning('id');
    const note = await clinicalNoteRepository.findById(clinicId, row.id);
    if (!note) throw new Error('Insert failed');
    return note;
  },

  async update(
    clinicId: string,
    id: string,
    data: Partial<{
      noteType:       string;
      noteDateTime:   string;
      content:        string;
      soapSubjective: string;
      soapObjective:  string;
      soapAssessment: string;
      soapPlan:       string;
      templateId:     string;
      isAiDraft:      boolean;
    }>,
    /**
     * HAZARD-006 optimistic-lock guard. When provided, the UPDATE
     * will ONLY succeed if the row's current lock_version matches
     * this value. A stale version → zero rows updated → caller
     * receives a synthetic {updated:false} response so the service
     * layer can translate to 409 CONFLICT.
     *
     * When undefined, the update proceeds without version
     * checking (for backwards compat with callers that don't
     * send If-Match) and the lock_version is still incremented.
     */
    expectedLockVersion?: number,
  ): Promise<ClinicalNoteRow> {
    const patch: Record<string, unknown> = {
      updated_at: db.fn.now(),
      // Use raw SQL for the increment so Knex doesn't serialise
      // the current value at JS layer (which would be a race).
      lock_version: db.raw('lock_version + 1'),
    };
    if (data.noteType       !== undefined) patch.note_type        = data.noteType;
    if (data.noteDateTime   !== undefined) patch.note_date_time   = data.noteDateTime;
    if (data.content        !== undefined) patch.content          = data.content;
    if (data.soapSubjective !== undefined) patch.soap_subjective  = data.soapSubjective;
    if (data.soapObjective  !== undefined) patch.soap_objective   = data.soapObjective;
    if (data.soapAssessment !== undefined) patch.soap_assessment  = data.soapAssessment;
    if (data.soapPlan       !== undefined) patch.soap_plan        = data.soapPlan;
    if (data.templateId     !== undefined) patch.template_id      = data.templateId;
    if (data.isAiDraft      !== undefined) patch.is_ai_draft      = data.isAiDraft;

    const query = db('clinical_notes')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at');

    // Optimistic-lock predicate: only update if the caller's
    // expected version matches the current DB value.
    if (typeof expectedLockVersion === 'number') {
      query.andWhere({ lock_version: expectedLockVersion });
    }

    const affected = await query.update(patch);

    if (affected === 0 && typeof expectedLockVersion === 'number') {
      // Zero rows updated AND caller provided a version → stale
      // read. Throw a structured error the service layer maps to
      // HTTP 409.
      throw Object.assign(
        new Error('Clinical note was modified by another writer — stale lock_version'),
        { status: 409, code: 'NOTE_CONFLICT' },
      );
    }

    const note = await clinicalNoteRepository.findById(clinicId, id);
    if (!note) throw new Error('Update failed');
    return note;
  },

  async sign(
    clinicId: string,
    id: string,
    signedById: string,
    opts: { markReviewedAndAdopted?: boolean } = {},
  ): Promise<ClinicalNoteRow> {
    const patch: Record<string, unknown> = {
      status: 'signed',
      signed_at: db.fn.now(),
      signed_by_id: signedById,
      updated_at: db.fn.now(),
    };
    // Audit Tier 5.8 — when the signer is adopting another clinician's
    // note, stamp the reviewed-and-adopted trail.
    if (opts.markReviewedAndAdopted) {
      patch.reviewed_and_adopted_by_id = signedById;
      patch.reviewed_and_adopted_at = db.fn.now();
    }
    await db('clinical_notes')
      .where({ id, clinic_id: clinicId, status: 'draft' })
      .whereNull('deleted_at')
      .update(patch);
    const note = await clinicalNoteRepository.findById(clinicId, id);
    if (!note) throw new Error('Sign failed');
    return note;
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db('clinical_notes')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ deleted_at: db.fn.now() });
  },
};
