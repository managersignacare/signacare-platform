// apps/api/src/features/flags/flagService.ts
// Centralised flag service — only backend modules call raise/resolve,
// not exposed as direct client write endpoints.
import {
  PatientFlagCreateDTO,
  PatientFlagResponse,
  PatientFlagResponseSchema,
} from '@signacare/shared';
import { flagRepository } from './flagRepository';
import { parseRow } from '../../shared/coerceRow';

function mapRowToResponse(row: Record<string, unknown>): PatientFlagResponse {
  const obj: Record<string, unknown> = {
    id:                  row['id'],
    clinicId:            row['clinic_id'],
    patientId:           row['patient_id'],
    episodeId:           row['episode_id'] ?? undefined,
    category:            row['category'],
    severity:            row['severity'],
    title:               row['title'],
    description:         row['description'] ?? undefined,
    status:              row['status'],
    raisedByStaffId:     row['raised_by_staff_id'],
    resolvedByStaffId:   row['resolved_by_staff_id'],
    raisedAt:            row['raised_at'],
    resolvedAt:          row['resolved_at'] ?? null,
    relatedRecordType:   row['related_record_type'] ?? undefined,
    relatedRecordId:     row['related_record_id'] ?? undefined,
    isHeaderFlag:        row['is_header_flag'],
    createdAt:           row['created_at'],
    updatedAt:           row['updated_at'],
  };
  return parseRow(obj, PatientFlagResponseSchema);
}

export const flagService = {
  /** Only backend modules call this — not exposed via routes */
  async raise(
    clinicId: string,
    staffId: string | null,
    dto: PatientFlagCreateDTO,
  ): Promise<PatientFlagResponse> {
    const duplicate = await flagRepository.findActiveDuplicate(
      clinicId,
      dto.patientId,
      dto.category,
      dto.severity,
      dto.title,
      dto.relatedRecordType,
      dto.relatedRecordId,
    );
    if (duplicate) return mapRowToResponse(duplicate as unknown as Record<string, unknown>);

    const row = await flagRepository.insert({
      clinic_id:           clinicId,
      patient_id:          dto.patientId,
      episode_id:          dto.episodeId ?? null,
      category:            dto.category,
      severity:            dto.severity,
      title:               dto.title,
      description:         dto.description ?? null,
      status:              'active',
      raised_by_staff_id:  staffId,
      resolved_by_staff_id: null,
      raised_at:           new Date().toISOString(),
      resolved_at:         null,
      related_record_type: dto.relatedRecordType ?? null,
      related_record_id:   dto.relatedRecordId ?? null,
      is_header_flag:      dto.isHeaderFlag ?? true,
    });
    return mapRowToResponse(row as unknown as Record<string, unknown>);
  },

  async resolveByRecord(
    clinicId: string,
    category: string,
    relatedRecordId: string,
    resolvedByStaffId?: string,
  ): Promise<void> {
    await flagRepository.resolveByRecord(clinicId, category, relatedRecordId, resolvedByStaffId);
  },

  async listHighSeverityForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<PatientFlagResponse[]> {
    const rows = await flagRepository.listHighSeverityForPatient(clinicId, patientId);
    return rows.map((r) => mapRowToResponse(r as unknown as Record<string, unknown>));
  },

  async listForPatient(
    clinicId: string,
    patientId: string,
  ): Promise<PatientFlagResponse[]> {
    const rows = await flagRepository.listForPatient(clinicId, patientId);
    return rows.map((r) => mapRowToResponse(r as unknown as Record<string, unknown>));
  },
};

// S4.3: alias export under the new canonical name. This module is the
// CLINICAL FLAGS service (raises patient alerts: suicide risk, falls
// risk, etc.). After S4.2 introduced the unrelated FEATURE FLAGS
// system in apps/api/src/shared/featureFlags.ts, the bare name
// "flagService" became ambiguous. New code should import
// `clinicalFlagService` (and `clinicalFlagRepository`) instead. The
// old `flagService` export is kept indefinitely for backward
// compatibility — it's a free alias.
export { flagService as clinicalFlagService };
