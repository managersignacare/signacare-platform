// apps/api/src/features/internal-medicine/problemListService.ts
import {
  CreateProblemDTO,
  UpdateProblemDTO,
  ProblemListEntry,
  ProblemListFilters,
} from '@signacare/shared';
import { problemListRepository, ProblemListRowWithRecorder } from './problemListRepository';
import { HttpError } from '../../shared/errors';
import auditLogService from '../../utils/audit';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function mapRow(row: ProblemListRowWithRecorder): ProblemListEntry {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    codeSystem: row.code_system as ProblemListEntry['codeSystem'],
    code: row.code,
    display: row.display,
    category: row.category as ProblemListEntry['category'],
    clinicalStatus: row.clinical_status as ProblemListEntry['clinicalStatus'],
    verificationStatus: row.verification_status as ProblemListEntry['verificationStatus'],
    severity: (row.severity ?? null) as ProblemListEntry['severity'],
    isChronic: row.is_chronic,
    onsetDate: row.onset_date,
    onsetAgeYears: row.onset_age_years,
    abatementDate: row.abatement_date,
    note: row.note,
    recordedDate: toIso(row.recorded_date)!,
    recordedBy: row.recorded_by,
    recordedByName:
      row.recorded_by_given_name && row.recorded_by_family_name
        ? `${row.recorded_by_given_name} ${row.recorded_by_family_name}`
        : null,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class ProblemListService {
  async listForPatient(
    clinicId: string,
    patientId: string,
    filters: ProblemListFilters,
  ): Promise<ProblemListEntry[]> {
    const rows = await problemListRepository.listForPatient(clinicId, patientId, {
      clinicalStatus: filters.clinicalStatus,
      isChronic: filters.isChronic,
      category: filters.category,
    });
    return rows.map(mapRow);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateProblemDTO,
  ): Promise<ProblemListEntry> {
    const created = await problemListRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      code_system: dto.codeSystem,
      code: dto.code,
      display: dto.display,
      category: dto.category,
      clinical_status: dto.clinicalStatus,
      verification_status: dto.verificationStatus,
      severity: dto.severity ?? null,
      is_chronic: dto.isChronic,
      onset_date: dto.onsetDate ?? null,
      onset_age_years: dto.onsetAgeYears ?? null,
      abatement_date: dto.abatementDate ?? null,
      note: dto.note ?? null,
      recorded_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'problem_list',
      recordId: created.id,
      newData: { code: created.code, display: created.display, status: created.clinical_status },
    });
    const hydrated = await problemListRepository.findById(clinicId, created.id);
    if (!hydrated) throw new HttpError(500, 'INTERNAL_ERROR', 'Failed to hydrate created problem');
    return mapRow(hydrated);
  }

  async update(
    clinicId: string,
    actorId: string,
    id: string,
    dto: UpdateProblemDTO,
  ): Promise<ProblemListEntry> {
    const existing = await problemListRepository.findById(clinicId, id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Problem not found');

    const patch: Record<string, unknown> = {};
    if (dto.episodeId !== undefined) patch.episode_id = dto.episodeId;
    if (dto.codeSystem !== undefined) patch.code_system = dto.codeSystem;
    if (dto.code !== undefined) patch.code = dto.code;
    if (dto.display !== undefined) patch.display = dto.display;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.clinicalStatus !== undefined) patch.clinical_status = dto.clinicalStatus;
    if (dto.verificationStatus !== undefined) patch.verification_status = dto.verificationStatus;
    if (dto.severity !== undefined) patch.severity = dto.severity;
    if (dto.isChronic !== undefined) patch.is_chronic = dto.isChronic;
    if (dto.onsetDate !== undefined) patch.onset_date = dto.onsetDate;
    if (dto.onsetAgeYears !== undefined) patch.onset_age_years = dto.onsetAgeYears;
    if (dto.abatementDate !== undefined) patch.abatement_date = dto.abatementDate;
    if (dto.note !== undefined) patch.note = dto.note;

    const updated = await problemListRepository.update(clinicId, id, patch);
    if (!updated) throw new HttpError(500, 'INTERNAL_ERROR', 'Failed to update problem');

    await auditLogService.logUpdate({
      clinicId,
      userId: actorId,
      tableName: 'problem_list',
      recordId: id,
      oldData: { status: existing.clinical_status },
      newData: { status: updated.clinical_status },
    });

    const hydrated = await problemListRepository.findById(clinicId, id);
    return mapRow(hydrated!);
  }

  async softDelete(clinicId: string, actorId: string, id: string): Promise<void> {
    const existing = await problemListRepository.findById(clinicId, id);
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Problem not found');
    await problemListRepository.softDelete(clinicId, id);
    await auditLogService.logDelete({
      clinicId,
      userId: actorId,
      tableName: 'problem_list',
      recordId: id,
      oldData: { code: existing.code, display: existing.display },
    });
  }
}

export const problemListService = new ProblemListService();
