import { db } from '../../db/db';
import type { AdvanceDirectivesRow } from '../../db/types/advance_directives';
import { ADVANCE_DIRECTIVES_COLUMNS } from '../../db/types/advance_directives';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';

export interface AdvanceDirectiveRow extends AdvanceDirectivesRow {
  // BUG-565 — migration adds lock_version; local extension keeps this
  // file type-safe before generated DB row interfaces refresh.
  lock_version: number;
}

function parseContent(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

export function mapAdvanceDirectiveRowToResponse(row: AdvanceDirectiveRow) {
  const c = parseContent(row.content);
  return {
    ...row,
    document_date: c.documentDate ?? c.document_date ?? row.valid_from ?? null,
    expires_at: c.expiryDate ?? c.expires_at ?? row.valid_until ?? null,
    directive_type: c.directiveType ?? c.directive_type ?? row.type ?? null,
    treatment_preferences: c.treatmentPreferences ?? c.treatment_preferences ?? null,
    refused_treatments: c.refusedTreatments ?? c.refused_treatments ?? null,
    nominated_person_name: c.nominatedPersonName ?? c.nominated_person_name ?? null,
    nominated_person_relationship: c.nominatedPersonRelationship ?? c.nominated_person_relationship ?? null,
    nominated_person_phone: c.nominatedPersonPhone ?? c.nominated_person_phone ?? null,
    nominated_person_email: c.nominatedPersonEmail ?? c.nominated_person_email ?? null,
    crisis_instructions: c.crisisInstructions ?? c.crisis_instructions ?? null,
    notes: c.notes ?? null,
    lockVersion: row.lock_version,
  };
}

export const ADVANCE_DIRECTIVE_COLUMNS = ADVANCE_DIRECTIVES_COLUMNS;

export type AdvanceDirectiveColumn = typeof ADVANCE_DIRECTIVE_COLUMNS[number];

export const advanceDirectiveRepository = {
  async listByPatient(clinicId: string, patientId: string): Promise<AdvanceDirectiveRow[]> {
    return db<AdvanceDirectiveRow>('advance_directives')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .orderBy('created_at', 'desc');
  },

  async findById(clinicId: string, id: string): Promise<AdvanceDirectiveRow | undefined> {
    return db<AdvanceDirectiveRow>('advance_directives')
      .where({ id, clinic_id: clinicId })
      .first(ADVANCE_DIRECTIVE_COLUMNS as unknown as string[]);
  },

  async create(row: {
    clinic_id: string;
    patient_id: string;
    type: string;
    content: unknown;
    status: string;
    valid_from: string | null;
    valid_until: string | null;
  }): Promise<AdvanceDirectiveRow> {
    const [created] = (await db<AdvanceDirectiveRow>('advance_directives')
      .insert({
        clinic_id: row.clinic_id,
        patient_id: row.patient_id,
        type: row.type,
        content: row.content,
        status: row.status,
        valid_from: row.valid_from,
        valid_until: row.valid_until,
      })
      .returning(ADVANCE_DIRECTIVE_COLUMNS as unknown as string[])) as AdvanceDirectiveRow[];
    return created;
  },

  async update(
    clinicId: string,
    id: string,
    expectedLockVersion: number,
    patch: Record<string, unknown>,
  ): Promise<AdvanceDirectiveRow> {
    // R-FIX-BUG-565-REPO-USES-HELPER
    return updateWithOptimisticLock<AdvanceDirectiveRow>({
      table: 'advance_directives',
      where: { id, clinic_id: clinicId },
      expectedLockVersion,
      patch,
      returning: ADVANCE_DIRECTIVE_COLUMNS as unknown as string[],
    });
  },
};
