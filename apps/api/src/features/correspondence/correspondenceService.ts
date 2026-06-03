import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import * as correspondenceRepo from './correspondenceRepository';
import { createAutoContactRecord } from '../contacts/autoContactRecord';
import { CLINICAL_AI_DISCLAIMER } from '../../shared/llmDisclaimer';
import type {
  LetterCreateDTO,
  LetterUpdateDTO,
  LetterResponse,
  GenerateLetterFromNoteDTO,
} from '@signacare/shared';

// ─── Mapping ──────────────────────────────────────────────────────────────────

function mapLetter(row: Record<string, unknown>): LetterResponse {
  return {
    id: row['id'] as string,
    clinicId: row['clinic_id'] as string,
    patientId: row['patient_id'] as string,
    episodeId: (row['episode_id'] as string | null) ?? null,
    clinicalNoteId: (row['clinical_note_id'] as string | null) ?? null,
    templateId: (row['template_id'] as string | null) ?? null,
    recipientProviderId: (row['recipient_provider_id'] as string | null) ?? null,
    recipientName: row['recipient_name'] as string,
    recipientEmail: (row['recipient_email'] as string | null) ?? null,
    recipientFax: (row['recipient_fax'] as string | null) ?? null,
    letterType: row['letter_type'] as string,
    subject: row['subject'] as string,
    body: row['body'] as string,
    status: row['status'] as LetterResponse['status'],
    sentAt: (row['sent_at'] as string | null) ?? null,
    sentVia: (row['sent_via'] as string | null) ?? null,
    generatedById: row['generated_by_id'] as string,
    notes: (row['notes'] as string | null) ?? null,
    specialtyCode: (row['episode_specialty_code'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function notFound(msg: string, code: string): Error & { status: number; code: string } {
  const err = new Error(msg) as Error & { status: number; code: string };
  err.status = 404;
  err.code = code;
  return err;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createLetter(
  clinicId: string,
  generatedById: string,
  dto: LetterCreateDTO,
): Promise<LetterResponse> {
  const row = await correspondenceRepo.createLetter(clinicId, generatedById, dto);
  const letter = mapLetter(row);

  // Auto-create ABF contact record for correspondence — awaited so the
  // contact record is committed before the response reaches the client.
  try {
    await createAutoContactRecord({
      clinicId,
      patientId: letter.patientId,
      episodeId: letter.episodeId ?? undefined,
      staffId: generatedById,
      sourceType: 'correspondence',
      sourceId: letter.id,
      contactType: 'Non-face-to-face — Clinical documentation',
      briefSummary: `${letter.letterType}: ${letter.subject}`,
    });
  } catch { /* already logged inside createAutoContactRecord */ }

  return letter;
}

export async function getLetter(
  clinicId: string,
  letterId: string,
): Promise<LetterResponse> {
  const row = await correspondenceRepo.findById(clinicId, letterId);
  if (!row) throw notFound('Letter not found', 'LETTER_NOT_FOUND');
  return mapLetter(row);
}

export async function listLettersByPatient(
  clinicId: string,
  patientId: string,
): Promise<LetterResponse[]> {
  const rows = await correspondenceRepo.findByPatient(clinicId, patientId);
  return rows.map(mapLetter);
}

export async function updateLetter(
  clinicId: string,
  letterId: string,
  dto: LetterUpdateDTO,
): Promise<LetterResponse> {
  const row = await correspondenceRepo.updateLetter(clinicId, letterId, dto);
  if (!row) throw notFound('Letter not found', 'LETTER_NOT_FOUND');
  return mapLetter(row);
}

export async function deleteLetter(
  clinicId: string,
  letterId: string,
): Promise<void> {
  await correspondenceRepo.softDelete(clinicId, letterId);
}

export async function listTemplates(
  clinicId: string,
): Promise<Record<string, unknown>[]> {
  return correspondenceRepo.findTemplatesByClinic(clinicId);
}

// ─── Generate Letter Drafts From Clinical Note ────────────────────────────────
//
// CONTRACT:
//   Given a clinicalNoteId + one or more recipientProviderIds, this method:
//   1. Fetches the clinical note (assessment_html, plan_html sections)
//   2. Resolves each provider's name/contact details from patient_providers or users
//   3. Applies the template body/subject (if provided) or builds a default structure
//   4. Returns one GeneratedLetterDraft per recipient — caller persists via createLetter()
//

interface ProviderStub {
  id: string;
  name: string;
  email: string | null;
  fax: string | null;
  providerNumber: string | null;
}

export interface GeneratedLetterDraft {
  recipientProviderId: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientFax: string | null;
  subject: string;
  body: string;
  // USER-E.4 / BUG-173: letters generated from a clinical note carry
  // the AI-DRAFT envelope flag + canonical disclaimer so downstream
  // consumers (UI banner, TGA audit) can distinguish derived letters
  // from clinician-authored originals. Tier 5.4 evidence class.
  isAiDraft: boolean;
  disclaimer: string;
}

export async function generateLetterDraftsFromNote(
  clinicId: string,
  dto: GenerateLetterFromNoteDTO,
): Promise<GeneratedLetterDraft[]> {
  // 1. Fetch the clinical note
  const note = await db('clinical_notes')
    .where({ id: dto.clinicalNoteId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first() as Record<string, unknown> | undefined;

  if (!note) throw notFound('Clinical note not found', 'NOTE_NOT_FOUND');

  // 2. Fetch patient details
  const patient = await db('patients')
    .where({ id: dto.patientId, clinic_id: clinicId })
    .first() as Record<string, unknown> | undefined;

  if (!patient) throw notFound('Patient not found', 'PATIENT_NOT_FOUND');

  // 3. Load template if provided
  let templateBody: string | null = null;
  let templateSubject: string | null = null;
  if (dto.templateId) {
    const tmpl = await correspondenceRepo.findTemplateById(clinicId, dto.templateId);
    if (tmpl) {
      templateBody = tmpl['body_template'] as string;
      templateSubject = tmpl['subject_template'] as string;
    }
  }

  // 4. Resolve provider details — try patient_providers (external) first, fall back to users
  const providers: ProviderStub[] = await Promise.all(
    dto.recipientProviderIds.map(async (providerId: string): Promise<ProviderStub> => {
      const pp = await db('patient_providers')
        .where({ id: providerId, clinic_id: clinicId })
        .first()
        .catch((err) => { logger.warn({ err }, 'correspondenceService: op failed — returning undefined'); return undefined; }) as Record<string, unknown> | undefined;

      if (pp) {
        return {
          id: providerId,
          name: `${pp['title'] ?? ''} ${pp['first_name'] ?? ''} ${pp['last_name'] ?? ''}`.trim(),
          email: (pp['email'] as string | null) ?? null,
          fax: (pp['fax'] as string | null) ?? null,
          providerNumber: (pp['provider_number'] as string | null) ?? null,
        };
      }

      // Fall back to internal staff (clinicians)
      const user = await db('staff')
        .where({ id: providerId, clinic_id: clinicId })
        .first() as Record<string, unknown> | undefined;

      return {
        id: providerId,
        name: user
          ? `${user['given_name'] ?? ''} ${user['family_name'] ?? ''}`.trim()
          : 'Unknown Provider',
        email: (user?.['email'] as string | null) ?? null,
        fax: null,
        providerNumber: (user?.['provider_number'] as string | null) ?? null,
      };
    }),
  );

  // 5. Build note body sections
  const patientName =
    `${patient['given_name'] ?? ''} ${patient['family_name'] ?? ''}`.trim();
  const dob = (patient['date_of_birth'] as string) ?? '';
  const noteDate = ((note['created_at'] as string) ?? '').slice(0, 10);

  const sections: string[] = [];
  sections.push(`Re: ${patientName} | DOB: ${dob} | Note Date: ${noteDate}\n`);

  if (dto.includeAssessment && note['assessment_html']) {
    sections.push('--- Assessment ---');
    sections.push(stripHtml(note['assessment_html'] as string));
    sections.push('');
  }

  if (dto.includePlan && note['plan_html']) {
    sections.push('--- Plan ---');
    sections.push(stripHtml(note['plan_html'] as string));
    sections.push('');
  }

  if (dto.includeMedications) {
    // Medications fetched from the medications table for this patient
    const meds = await db('patient_medications')
      .where({ patient_id: dto.patientId, clinic_id: clinicId })
      .whereNull('end_date')
      .whereNull('deleted_at')
      .select('drug_label', 'dose', 'frequency', 'route')
      .orderBy('drug_label') as Record<string, unknown>[];

    if (meds.length > 0) {
      sections.push('--- Current Medications ---');
      meds.forEach((m) => {
        sections.push(
          `• ${m['drug_label']} ${m['dose'] ?? ''} ${m['route'] ?? ''} ${m['frequency'] ?? ''}`.trim(),
        );
      });
      sections.push('');
    }
  }

  if (dto.customNotes) {
    sections.push('--- Additional Notes ---');
    sections.push(dto.customNotes);
    sections.push('');
  }

  const noteBodyText = sections.join('\n');

  // 6. Generate one draft per provider
  return providers.map((provider): GeneratedLetterDraft => {
    const subject = templateSubject
      ? interpolate(templateSubject, {
          patient: patientName,
          provider: provider.name,
          noteDate,
        })
      : `Clinical Correspondence — ${patientName} — ${noteDate}`;

    const body = templateBody
      ? interpolate(templateBody, {
          patient: patientName,
          patientDob: dob,
          provider: provider.name,
          noteDate,
          noteBody: noteBodyText,
        })
      : buildDefaultBody(provider.name, noteBodyText);

    return {
      recipientProviderId: provider.id,
      recipientName: provider.name,
      recipientEmail: provider.email,
      recipientFax: provider.fax,
      subject,
      body,
      // USER-E.4 / BUG-173: letters derived from a clinical note are
      // AI-drafts for Tier 5.4 audit purposes. Disclaimer string is
      // the canonical SSoT constant from shared/llmDisclaimer so any
      // future envelope check (R-FIX-CLINICAL-DISCLAIMER-ENVELOPE /
      // BUG-038) treats this path the same way.
      isAiDraft: true,
      disclaimer: CLINICAL_AI_DISCLAIMER,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

function buildDefaultBody(recipientName: string, noteBody: string): string {
  return [
    `Dear ${recipientName},`,
    '',
    'I am writing to provide a clinical update regarding our shared patient.',
    '',
    noteBody,
    '',
    'Please do not hesitate to contact our clinic if you have any questions.',
    '',
    'Yours sincerely,',
    '{{clinician.name}}',
    '{{clinician.providerNumber}}',
    'Signacare Mental Health',
  ].join('\n');
}
