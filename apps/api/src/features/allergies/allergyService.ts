// apps/api/src/features/allergies/allergyService.ts
import {
  AllergyResponse,
  AllergyResponseSchema,
  CreateAllergyDTO,
  UpdateAllergyDTO,
} from '@signacare/shared';
import { allergyRepository } from './allergyRepository';
import { AppError } from '../../shared/errors';
import { parseRow } from '../../shared/coerceRow';

function mapRowToResponse(row: Record<string, unknown>): AllergyResponse {
  const obj: Record<string, unknown> = {
    id:                  row['id'],
    clinicId:            row['clinic_id'],
    patientId:           row['patient_id'],
    allergen:            row['allergen'],
    allergenType:        row['allergen_type'],
    reaction:            row['reaction'] ?? undefined,
    severity:            row['severity'],
    status:              row['status'],
    recordedByStaffId:   row['recorded_by_staff_id'],
    recordedAt:          row['recorded_at'],
    notes:               row['notes'] ?? undefined,
    createdAt:           row['created_at'],
    updatedAt:           row['updated_at'],
  };
  return parseRow(obj, AllergyResponseSchema);
}

export const allergyService = {
  async create(
    clinicId: string,
    staffId: string,
    dto: CreateAllergyDTO,
  ): Promise<AllergyResponse> {
    const row = await allergyRepository.create(clinicId, staffId, dto);
    return mapRowToResponse(row as unknown as Record<string, unknown>);
  },

  async update(
    clinicId: string,
    id: string,
    dto: UpdateAllergyDTO,
  ): Promise<AllergyResponse> {
    const row = await allergyRepository.update(clinicId, id, dto);
    if (!row) throw new AppError('Allergy not found', 404, 'NOT_FOUND');
    return mapRowToResponse(row as unknown as Record<string, unknown>);
  },

  async listForPatient(clinicId: string, patientId: string): Promise<AllergyResponse[]> {
    const rows = await allergyRepository.listForPatient(clinicId, patientId);
    return rows.map((r) => mapRowToResponse(r as unknown as Record<string, unknown>));
  },

  async getById(clinicId: string, id: string): Promise<AllergyResponse> {
    const row = await allergyRepository.findById(clinicId, id);
    if (!row) throw new AppError('Allergy not found', 404, 'NOT_FOUND');
    return mapRowToResponse(row as unknown as Record<string, unknown>);
  },

  /**
   * Simple drug conflict check — substring match between the requested drug
   * name and active drug allergen records. Returns conflicting allergy rows.
   */
  async checkDrugConflict(
    clinicId: string,
    patientId: string,
    medicationName: string,
  ): Promise<AllergyResponse[]> {
    const rows = await allergyRepository.findActiveDrugAllergiesForPatient(clinicId, patientId);
    const lowerMed = medicationName.toLowerCase();
    const conflicting = rows.filter(
      (row) =>
        row.allergen.toLowerCase().includes(lowerMed) ||
        lowerMed.includes(row.allergen.toLowerCase()),
    );
    return conflicting.map((r) => mapRowToResponse(r as unknown as Record<string, unknown>));
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    const row = await allergyRepository.findById(clinicId, id);
    if (!row) throw new AppError('Allergy not found', 404, 'NOT_FOUND');
    await allergyRepository.softDelete(clinicId, id);
  },
};
