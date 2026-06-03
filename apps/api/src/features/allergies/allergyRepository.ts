// apps/api/src/features/allergies/allergyRepository.ts
import { db } from '../../db/db';
import type { CreateAllergyDTO, UpdateAllergyDTO } from '@signacare/shared';

export interface AllergyRow {
  id:                   string;
  clinic_id:            string;
  patient_id:           string;
  allergen:             string;
  allergen_type:        string;
  reaction:             string | null;
  severity:             string;
  status:               string;
  recorded_by_staff_id: string | null;
  recorded_at:          string;
  notes:                string | null;
  created_at:           string;
  updated_at:           string;
  deleted_at:           string | null;
}

// Explicit column list for .returning() — avoids exposing PII and avoids
// the "tech-debt returning" category (Phase R3 / CLAUDE.md §1.7). Verified
// against schema-snapshot.json: patient_allergies has exactly these columns.
const ALLERGY_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'allergen',
  'allergen_type',
  'reaction',
  'severity',
  'status',
  'recorded_by_staff_id',
  'recorded_at',
  'notes',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export const allergyRepository = {
  async create(
    clinicId: string,
    staffId: string,
    dto: CreateAllergyDTO,
  ): Promise<AllergyRow> {
    const [row] = await db('patient_allergies')
      .insert({
        clinic_id:            clinicId,
        patient_id:           dto.patientId,
        allergen:             dto.allergen,
        allergen_type:        dto.allergenType,
        reaction:             dto.reaction ?? null,
        severity:             dto.severity,
        status:               dto.status,
        recorded_by_staff_id: staffId,
        recorded_at:          dto.recordedAt ?? new Date(),
        notes:                dto.notes ?? null,
        created_at:           new Date(),
        updated_at:           new Date(),
      })
      .returning(ALLERGY_COLUMNS);
    return row as AllergyRow;
  },

  async update(
    clinicId: string,
    id: string,
    dto: UpdateAllergyDTO,
  ): Promise<AllergyRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.allergen     !== undefined) patch['allergen']      = dto.allergen;
    if (dto.allergenType !== undefined) patch['allergen_type'] = dto.allergenType;
    if (dto.reaction     !== undefined) patch['reaction']      = dto.reaction;
    if (dto.severity     !== undefined) patch['severity']      = dto.severity;
    if (dto.status       !== undefined) patch['status']        = dto.status;
    if (dto.notes        !== undefined) patch['notes']         = dto.notes;

    const [row] = await db('patient_allergies')
      .where('clinic_id', clinicId)
      .andWhere('id', id)
      .whereNull('deleted_at')
      .update(patch)
      .returning(ALLERGY_COLUMNS);
    return row as AllergyRow | undefined;
  },

  async listForPatient(clinicId: string, patientId: string): Promise<AllergyRow[]> {
    const rows = await db('patient_allergies')
      .where('clinic_id', clinicId)
      .andWhere('patient_id', patientId)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
    return rows as AllergyRow[];
  },

  async findById(clinicId: string, id: string): Promise<AllergyRow | undefined> {
    const row = await db('patient_allergies')
      .where('clinic_id', clinicId)
      .andWhere('id', id)
      .whereNull('deleted_at')
      .first();
    return row as AllergyRow | undefined;
  },

  async findActiveDrugAllergiesForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<AllergyRow[]> {
    const rows = await db('patient_allergies').where({
      clinic_id:    clinicId,
      patient_id:   patientId,
      allergen_type: 'drug',
      status:       'active',
    }).whereNull('deleted_at');
    return rows as AllergyRow[];
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db('patient_allergies')
      .where('clinic_id', clinicId)
      .andWhere('id', id)
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
  },
};
