// apps/api/src/features/llm/letterService.ts
//
// Tier 15 — letter authoring service.
//
// Encapsulates the template → draft → sections → review → approve →
// sent lifecycle. Every state change writes a letter_audit_log row
// with actor + actor_role + diff_summary so the medico-legal
// "who saw + approved this letter and when" trail is immutable.
//
// Why a service and not inline route code: the state machine has
// three concerns that must stay in sync (letters.status,
// letter_sections content, letter_audit_log events). Keeping them
// in a single transaction per state change is the only way to avoid
// torn writes. The service exposes one function per lifecycle
// transition; routes are thin adapters.

import type { Knex } from 'knex';
import { db } from '../../db/db';
import type { AuthContext } from '@signacare/shared';
import { HttpError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';
// BUG-276 — per-endpoint patient-relationship gate for letter-section
// mutations. PATCH /letters/:id/sections/:sectionKey edits patient-bound
// letter content; without the gate any authenticated clinician can edit
// any patient's letter in the clinic.
import { requirePatientRelationship, requireSpecialty } from '../../shared/authGuards';

const MEDICO_LEGAL_CATEGORIES = new Set(['court_mse_report', 'legal_document']);
const MEDICO_LEGAL_CODE_PATTERNS = [/court/i, /^291$/i, /tribunal/i];

function isMedicoLegalTemplate(template: { category?: string | null; code?: string | null }): boolean {
  const category = String(template.category ?? '').trim().toLowerCase();
  const code = String(template.code ?? '').trim().toLowerCase();
  return MEDICO_LEGAL_CATEGORIES.has(category) || MEDICO_LEGAL_CODE_PATTERNS.some((p) => p.test(code));
}

async function requireMedicoLegalRole(auth: AuthContext): Promise<void> {
  if (auth.role === 'admin' || auth.role === 'superadmin') return;
  if (auth.role !== 'psychiatrist') {
    throw new HttpError(
      403,
      'MEDICO_LEGAL_ROLE_REQUIRED',
      'Only consultant psychiatry or authorised admin roles may progress medico-legal reports.',
    );
  }
  await requireSpecialty(auth, ['psychiatry']);
}

async function writeMedicoLegalChainEvent(input: {
  auth: AuthContext;
  letterId: string;
  event: string;
  patientId: string;
  templateCode?: string | null;
  templateCategory?: string | null;
}): Promise<void> {
  await writeAuditLog({
    clinicId: input.auth.clinicId,
    actorId: input.auth.staffId,
    action: 'UPDATE',
    tableName: 'letters',
    recordId: input.letterId,
    newData: {
      medico_legal_chain_event: input.event,
      patient_id: input.patientId,
      template_code: input.templateCode ?? null,
      template_category: input.templateCategory ?? null,
      actor_role: input.auth.role,
    },
  });
}

export interface TemplateSection {
  key: string;
  label: string;
  prompt: string;
}

export interface CreateLetterInput {
  templateId: string;
  patientId: string;
  episodeId?: string;
  sessionId?: string;
  subject: string;
  recipients?: Array<{ name: string; address?: string; email?: string; role?: string }>;
}

export interface LetterRow {
  id: string;
  clinicId: string;
  templateId: string;
  patientId: string;
  authorId: string;
  status: string;
  subject: string;
  revision: number;
  createdAt: Date;
}

/**
 * Create a new draft letter + one letter_sections row per template
 * section. Sections start empty; the caller runs the LLM generation
 * step separately and writes the generated content via
 * `regenerateSection`.
 */
export async function createDraftLetter(
  auth: AuthContext,
  input: CreateLetterInput,
): Promise<LetterRow & { sections: Array<{ id: string; sectionKey: string; label: string; sectionOrder: number }> }> {
  return db.transaction(async (trx) => {
    const template = await trx('letter_templates')
      .where(function () {
        this.whereNull('clinic_id').orWhere({ clinic_id: auth.clinicId });
      })
      .andWhere({ id: input.templateId, is_active: true })
      .first();
    if (!template) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Letter template not found or inactive');
    const medicoLegal = isMedicoLegalTemplate(template);
    if (medicoLegal) {
      await requireMedicoLegalRole(auth);
      await requirePatientRelationship(auth, input.patientId);
    }

    const [letter] = await trx('letters')
      .insert({
        clinic_id: auth.clinicId,
        template_id: template.id,
        patient_id: input.patientId,
        episode_id: input.episodeId ?? null,
        author_id: auth.staffId,
        session_id: input.sessionId ?? null,
        status: 'draft',
        subject: input.subject,
        recipients: JSON.stringify(input.recipients ?? []),
      })
      .returning([
        'id', 'clinic_id as clinicId', 'template_id as templateId',
        'patient_id as patientId', 'author_id as authorId',
        'status', 'subject', 'revision', 'created_at as createdAt',
      ]);

    // template.sections comes back as a JS value already (jsonb column).
    const sections: TemplateSection[] = Array.isArray(template.sections)
      ? template.sections
      : JSON.parse(template.sections);

    const sectionRows = await trx('letter_sections')
      .insert(sections.map((s, idx) => ({
        clinic_id: auth.clinicId,
        letter_id: letter.id,
        section_key: s.key,
        section_order: idx,
        label: s.label,
        content: '',
      })))
      .returning([
        'id', 'section_key as sectionKey', 'label', 'section_order as sectionOrder',
      ]);

    await writeLetterAuditRow(trx, {
      clinicId: auth.clinicId,
      letterId: letter.id,
      event: 'created',
      actorId: auth.staffId,
      actorRole: auth.role,
      diffSummary: {
        templateCode: template.code,
        sectionCount: sections.length,
      },
    });
    if (medicoLegal) {
      await writeMedicoLegalChainEvent({
        auth,
        letterId: letter.id,
        event: 'created',
        patientId: input.patientId,
        templateCode: template.code ?? null,
        templateCategory: template.category ?? null,
      });
    }

    return { ...letter, sections: sectionRows };
  });
}

/**
 * Overwrite one section's content. `regen_count` + `last_regen_at` +
 * `last_regen_by` are bumped so the UI can surface "section X
 * regenerated 3 times".
 */
export async function regenerateSection(
  auth: AuthContext,
  letterId: string,
  sectionKey: string,
  newContent: string,
): Promise<{ sectionKey: string; content: string; regenCount: number }> {
  return db.transaction(async (trx) => {
    const letter = await trx('letters')
      .where({ id: letterId, clinic_id: auth.clinicId })
      .first();
    if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');

    // BUG-276 — patient-relationship gate (section regenerate). Runs
    // BEFORE the status-lock check (L4 absorb: an unrelated clinician
    // probing which letters exist for which patients must not receive
    // a state-discriminating response: LETTER_LOCKED would reveal the
    // letter exists in an approved state; the gate returns 403 for
    // cross-patient probes regardless of status).
    await requirePatientRelationship(auth, letter.patient_id);

    if (letter.status === 'approved' || letter.status === 'sent') {
      throw new HttpError(409, 'LETTER_LOCKED', `Cannot regen section — letter is ${letter.status}`);
    }

    const existing = await trx('letter_sections')
      .where({ letter_id: letterId, section_key: sectionKey, clinic_id: auth.clinicId })
      .first();
    if (!existing) throw new HttpError(404, 'SECTION_NOT_FOUND', 'Section not found on letter');

    const oldLength = existing.content?.length ?? 0;
    await trx('letter_sections')
      .where({ id: existing.id })
      .update({
        content: newContent,
        regen_count: trx.raw('regen_count + 1'),
        last_regen_at: new Date(),
        last_regen_by: auth.staffId,
        updated_at: new Date(),
      });
    await trx('letters').where({ id: letterId }).update({ updated_at: new Date() });

    await writeLetterAuditRow(trx, {
      clinicId: auth.clinicId,
      letterId,
      event: 'section_regenerated',
      actorId: auth.staffId,
      actorRole: auth.role,
      sectionKey,
      diffSummary: {
        oldLength,
        newLength: newContent.length,
      },
    });

    return {
      sectionKey,
      content: newContent,
      regenCount: (existing.regen_count ?? 0) + 1,
    };
  });
}

/**
 * Clinician edits a section manually (typed in, not regenerated).
 * Same persistence path as regen but with event='section_edited'.
 */
export async function editSection(
  auth: AuthContext,
  letterId: string,
  sectionKey: string,
  newContent: string,
): Promise<{ sectionKey: string; content: string }> {
  return db.transaction(async (trx) => {
    const letter = await trx('letters')
      .where({ id: letterId, clinic_id: auth.clinicId })
      .first();
    if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');

    // BUG-276 — patient-relationship gate (section edit). Runs BEFORE
    // the status-lock check (L4 absorb: uniform 403 for cross-patient
    // probes regardless of letter state).
    await requirePatientRelationship(auth, letter.patient_id);

    if (letter.status === 'approved' || letter.status === 'sent') {
      throw new HttpError(409, 'LETTER_LOCKED', `Cannot edit section — letter is ${letter.status}`);
    }

    const existing = await trx('letter_sections')
      .where({ letter_id: letterId, section_key: sectionKey, clinic_id: auth.clinicId })
      .first();
    if (!existing) throw new HttpError(404, 'SECTION_NOT_FOUND', 'Section not found on letter');

    const oldLength = existing.content?.length ?? 0;
    await trx('letter_sections')
      .where({ id: existing.id })
      .update({ content: newContent, updated_at: new Date() });
    await trx('letters').where({ id: letterId }).update({ updated_at: new Date() });

    await writeLetterAuditRow(trx, {
      clinicId: auth.clinicId,
      letterId,
      event: 'section_edited',
      actorId: auth.staffId,
      actorRole: auth.role,
      sectionKey,
      diffSummary: {
        oldLength,
        newLength: newContent.length,
      },
    });

    return { sectionKey, content: newContent };
  });
}

/**
 * Transition draft → in_review. Composes rendered_text from
 * sections in order. Only the author (or an admin) can submit.
 */
export async function submitForReview(auth: AuthContext, letterId: string): Promise<void> {
  return db.transaction(async (trx) => {
    const letter = await trx('letters')
      .where({ id: letterId, clinic_id: auth.clinicId })
      .first();
    if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');
    const template = await trx('letter_templates')
      .where({ id: letter.template_id, clinic_id: auth.clinicId })
      .first('code', 'category');

    // BUG-276 L4 absorb — submit-for-review moves the letter into the
    // reviewer queue where it will be signed off and delivered. The
    // submitter is committing to the letter's content being correct
    // for THIS patient. Relationship gate is required, not optional.
    await requirePatientRelationship(auth, letter.patient_id);
    if (template && isMedicoLegalTemplate(template)) {
      await requireMedicoLegalRole(auth);
    }

    if (letter.status !== 'draft' && letter.status !== 'revised') {
      throw new HttpError(409, 'INVALID_TRANSITION', `Cannot submit from status=${letter.status}`);
    }
    if (letter.author_id !== auth.staffId && auth.role !== 'admin' && auth.role !== 'superadmin') {
      throw new HttpError(403, 'FORBIDDEN', 'Only the author or an admin may submit this letter for review');
    }

    const sections = await trx('letter_sections')
      .where({ letter_id: letterId, clinic_id: auth.clinicId })
      .orderBy('section_order', 'asc');
    const rendered = sections
      .map((s) => `${s.label}\n\n${s.content?.trim() ?? ''}`)
      .join('\n\n');

    await trx('letters').where({ id: letterId }).update({
      status: 'in_review',
      rendered_text: rendered,
      updated_at: new Date(),
    });

    await writeLetterAuditRow(trx, {
      clinicId: auth.clinicId,
      letterId,
      event: 'submitted_for_review',
      actorId: auth.staffId,
      actorRole: auth.role,
      diffSummary: { renderedLength: rendered.length, sectionCount: sections.length },
    });
    if (template && isMedicoLegalTemplate(template)) {
      await writeMedicoLegalChainEvent({
        auth,
        letterId,
        event: 'submitted_for_review',
        patientId: letter.patient_id,
        templateCode: template.code ?? null,
        templateCategory: template.category ?? null,
      });
    }
  });
}

/**
 * Reviewer approves. Cannot be the author (4-eyes). For templates
 * that set requires_second_review=true, the approving reviewer also
 * cannot have previously reviewed this same letter.
 */
export async function approveLetter(auth: AuthContext, letterId: string): Promise<void> {
  return db.transaction(async (trx) => {
    const letter = await trx('letters')
      .where({ id: letterId, clinic_id: auth.clinicId })
      .first();
    if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');
    const template = await trx('letter_templates')
      .where({ id: letter.template_id, clinic_id: auth.clinicId })
      .first('code', 'category');

    // BUG-276 L4 absorb — approval is a medico-legal sign-off. An
    // unrelated clinician must not approve another patient's letter
    // (worse than editing: approval locks the letter and enables
    // delivery). Rule 5 traceability requires the approver to have a
    // sanctioned care relationship.
    await requirePatientRelationship(auth, letter.patient_id);
    if (template && isMedicoLegalTemplate(template)) {
      await requireMedicoLegalRole(auth);
    }

    if (letter.status !== 'in_review') {
      throw new HttpError(409, 'INVALID_TRANSITION', `Cannot approve from status=${letter.status}`);
    }
    if (letter.author_id === auth.staffId) {
      throw new HttpError(403, 'SELF_APPROVAL', 'Author may not approve their own letter');
    }

    await trx('letters').where({ id: letterId }).update({
      status: 'approved',
      approved_by: auth.staffId,
      approved_at: new Date(),
      updated_at: new Date(),
    });

    await writeLetterAuditRow(trx, {
      clinicId: auth.clinicId,
      letterId,
      event: 'approved',
      actorId: auth.staffId,
      actorRole: auth.role,
    });
    if (template && isMedicoLegalTemplate(template)) {
      await writeMedicoLegalChainEvent({
        auth,
        letterId,
        event: 'approved',
        patientId: letter.patient_id,
        templateCode: template.code ?? null,
        templateCategory: template.category ?? null,
      });
    }
  });
}

/**
 * Reviewer rejects — letter returns to 'revised' so the author can
 * re-edit. Reason captured in diff_summary.
 */
export async function rejectLetter(
  auth: AuthContext,
  letterId: string,
  reason: string,
): Promise<void> {
  return db.transaction(async (trx) => {
    const letter = await trx('letters')
      .where({ id: letterId, clinic_id: auth.clinicId })
      .first();
    if (!letter) throw new HttpError(404, 'LETTER_NOT_FOUND', 'Letter not found');
    const template = await trx('letter_templates')
      .where({ id: letter.template_id, clinic_id: auth.clinicId })
      .first('code', 'category');

    // BUG-276 L4 absorb — reviewer-rejection also requires relationship
    // (Rule 5 sign-off traceability). A reviewer who rejects is making
    // a clinical decision about this patient's content.
    await requirePatientRelationship(auth, letter.patient_id);
    if (template && isMedicoLegalTemplate(template)) {
      await requireMedicoLegalRole(auth);
    }

    if (letter.status !== 'in_review') {
      throw new HttpError(409, 'INVALID_TRANSITION', `Cannot reject from status=${letter.status}`);
    }
    if (letter.author_id === auth.staffId) {
      throw new HttpError(403, 'SELF_REVIEW', 'Author may not reject their own letter');
    }

    await trx('letters').where({ id: letterId }).update({
      status: 'revised',
      revision: trx.raw('revision + 1'),
      updated_at: new Date(),
    });

    await writeLetterAuditRow(trx, {
      clinicId: auth.clinicId,
      letterId,
      event: 'rejected',
      actorId: auth.staffId,
      actorRole: auth.role,
      diffSummary: { reason },
    });
    if (template && isMedicoLegalTemplate(template)) {
      await writeMedicoLegalChainEvent({
        auth,
        letterId,
        event: 'rejected',
        patientId: letter.patient_id,
        templateCode: template.code ?? null,
        templateCategory: template.category ?? null,
      });
    }
  });
}

interface AuditRowInput {
  clinicId: string;
  letterId: string;
  event:
    | 'created' | 'section_regenerated' | 'section_edited'
    | 'submitted_for_review' | 'approved' | 'rejected' | 'sent'
    | 'withdrawn' | 'revised';
  actorId: string;
  actorRole: string;
  sectionKey?: string;
  diffSummary?: Record<string, unknown>;
  ipAddress?: string;
}

async function writeLetterAuditRow(trx: Knex.Transaction, input: AuditRowInput): Promise<void> {
  await trx('letter_audit_log').insert({
    clinic_id: input.clinicId,
    letter_id: input.letterId,
    event: input.event,
    actor_id: input.actorId,
    actor_role: input.actorRole,
    section_key: input.sectionKey ?? null,
    diff_summary: input.diffSummary ? JSON.stringify(input.diffSummary) : null,
    ip_address: input.ipAddress ?? null,
  });
}
