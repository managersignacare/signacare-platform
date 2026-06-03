import { randomUUID } from 'crypto';
import { db } from '../../db/db';
import type { LetterCreateDTO, LetterUpdateDTO } from '@signacare/shared';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: correspondence_letters has these 27 columns. Notable
// preservations from baseline:
//   - NO updated_at column (intentional — letters are append-only;
//     status transitions are tracked via sent_at + signed_at)
//   - search_tsv is GENERATED — never written, only queried
//   - audit_trigger_fn provides the change history
const CORRESPONDENCE_LETTER_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'episode_id',
  'author_id',
  'recipient_name',
  'recipient_address',
  'recipient_email',
  'recipient_fax',
  'recipient_provider_id',
  'letter_type',
  'subject',
  'content',
  'body',
  'status',
  'clinical_note_id',
  'template_id',
  'generated_by_id',
  'notes',
  'sent_via',
  'created_at',
  'sent_at',
  'deleted_at',
  'signature_data',
  'signed_by_id',
  'signed_at',
] as const;

export async function createLetter(
  clinicId: string,
  generatedById: string,
  dto: LetterCreateDTO,
): Promise<Record<string, unknown>> {
  // If the caller did not supply episode_id, resolve it from the patient's
  // most recent open episode. This guarantees every letter is discoverable
  // from the episode timeline (users expect "any letter created from any tab
  // should be shown in the episode").
  let resolvedEpisodeId = dto.episodeId ?? null;
  if (!resolvedEpisodeId && dto.patientId) {
    const ep = await db('episodes')
      .where({ patient_id: dto.patientId, clinic_id: clinicId, status: 'open' })
      .whereNull('deleted_at')
      .orderBy('start_date', 'desc')
      .first();
    if (ep) resolvedEpisodeId = ep.id as string;
  }
  // correspondence_letters has NO updated_at column — letters are
  // append-only with status transitions tracked via sent_at + signed_at.
  const [row] = await db('correspondence_letters')
    .insert({
      id: randomUUID(),
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: resolvedEpisodeId,
      clinical_note_id: dto.clinicalNoteId ?? null,
      template_id: dto.templateId ?? null,
      recipient_provider_id: dto.recipientProviderId ?? null,
      recipient_name: dto.recipientName,
      recipient_email: dto.recipientEmail ?? null,
      recipient_fax: dto.recipientFax ?? null,
      letter_type: dto.letterType,
      subject: dto.subject,
      body: dto.body,
      status: dto.status ?? 'draft',
      generated_by_id: generatedById,
      notes: dto.notes ?? null,
    })
    .returning(CORRESPONDENCE_LETTER_COLUMNS);
  return row as Record<string, unknown>;
}

export async function findById(
  clinicId: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return db('correspondence_letters')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first() as Promise<Record<string, unknown> | undefined>;
}

export async function findByPatient(
  clinicId: string,
  patientId: string,
): Promise<Record<string, unknown>[]> {
  // Left-join episodes so the frontend SpecialtyFilterChips can filter
  // letters by the episode's specialty. Alias is snake_case so the
  // camelCaseResponse middleware converts it to episodeSpecialtyCode
  // (ALIAS1-4 in the Fix Registry — see CLAUDE.md naming contract).
  return db('correspondence_letters as cl')
    .leftJoin('episodes as e', 'e.id', 'cl.episode_id')
    .where({ 'cl.clinic_id': clinicId, 'cl.patient_id': patientId })
    .whereNull('cl.deleted_at')
    .orderBy('cl.created_at', 'desc')
    .select('cl.*', 'e.specialty_code as episode_specialty_code') as Promise<Record<string, unknown>[]>;
}

export async function updateLetter(
  clinicId: string,
  id: string,
  dto: LetterUpdateDTO,
): Promise<Record<string, unknown> | undefined> {
  // No updated_at on correspondence_letters (see CORRESPONDENCE_LETTER_COLUMNS comment).
  const updates: Record<string, unknown> = {};
  if (dto.subject) updates['subject'] = dto.subject;
  if (dto.body) updates['body'] = dto.body;
  if (dto.status) updates['status'] = dto.status;
  if (dto.sentVia) {
    updates['sent_via'] = dto.sentVia;
    updates['sent_at'] = db.fn.now();
  }
  if (dto.notes !== undefined) updates['notes'] = dto.notes;

  const [row] = await db('correspondence_letters')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .update(updates)
    .returning(CORRESPONDENCE_LETTER_COLUMNS);
  return row as Record<string, unknown> | undefined;
}

export async function softDelete(clinicId: string, id: string): Promise<void> {
  // No updated_at on correspondence_letters; soft-delete via deleted_at only.
  await db('correspondence_letters')
    .where({ id, clinic_id: clinicId })
    .update({ deleted_at: db.fn.now() });
}

export async function findTemplatesByClinic(
  clinicId: string,
): Promise<Record<string, unknown>[]> {
  // clinical_templates has NO deleted_at column (per Phase R2 baseline).
  // Active=false is the supersedure mechanism.
  return db('clinical_templates')
    .where({ clinic_id: clinicId, is_active: true })
    .orderBy('name') as Promise<Record<string, unknown>[]>;
}
// Append to correspondenceRepository.ts

export async function findTemplateById(
  clinicId: string,
  templateId: string,
): Promise<Record<string, unknown> | undefined> {
  // clinical_templates has NO deleted_at column (per Phase R2 baseline).
  return db('clinical_templates')
    .where({ id: templateId, clinic_id: clinicId, is_active: true })
    .first() as Promise<Record<string, unknown> | undefined>;
}
