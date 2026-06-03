// apps/api/src/features/paediatrics/paediatricsServices.ts
//
// Multi-specialty Phase 5 — Paediatrics: orchestration layer for the
// three paediatric resources. Maps DB rows to FHIR-aligned response
// DTOs and writes audit-log entries on every mutation.
import {
  CreateGrowthMeasurementDTO,
  GrowthMeasurementResponse,
  CreateImmunizationDTO,
  ImmunizationResponse,
  CreateMilestoneDTO,
  MilestoneResponse,
} from '@signacare/shared';
import {
  growthMeasurementRepository,
  immunizationRepository,
  milestoneRepository,
  type GrowthMeasurementRowWithRecorder,
  type ImmunizationRowWithAdmin,
  type MilestoneRowWithAssessor,
} from './paediatricsRepositories';
import auditLogService from '../../utils/audit';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function num(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function staffName(given?: string | null, family?: string | null): string | null {
  return given && family ? `${given} ${family}` : null;
}

// ── growth_measurements ──────────────────────────────────────────────────

function mapGrowth(row: GrowthMeasurementRowWithRecorder): GrowthMeasurementResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    measurementType: row.measurement_type as GrowthMeasurementResponse['measurementType'],
    value: Number(row.value),
    unit: row.unit,
    ageAtMeasurementDays: row.age_at_measurement_days,
    percentile: num(row.percentile),
    zScore: num(row.z_score),
    referenceSource: (row.reference_source ?? null) as GrowthMeasurementResponse['referenceSource'],
    measuredAt: toIso(row.measured_at)!,
    recordedBy: row.recorded_by,
    recordedByName: staffName(row.recorded_by_given_name, row.recorded_by_family_name),
    note: row.note,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class GrowthMeasurementService {
  async listForPatient(clinicId: string, patientId: string): Promise<GrowthMeasurementResponse[]> {
    const rows = await growthMeasurementRepository.listForPatient(clinicId, patientId);
    return rows.map(mapGrowth);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateGrowthMeasurementDTO,
  ): Promise<GrowthMeasurementResponse> {
    const created = await growthMeasurementRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      measurement_type: dto.measurementType,
      value: dto.value,
      unit: dto.unit,
      age_at_measurement_days: dto.ageAtMeasurementDays,
      percentile: dto.percentile ?? null,
      z_score: dto.zScore ?? null,
      reference_source: dto.referenceSource ?? null,
      measured_at: new Date(dto.measuredAt),
      recorded_by: actorId,
      note: dto.note ?? null,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'growth_measurements',
      recordId: created.id,
      newData: { type: created.measurement_type, value: created.value, unit: created.unit },
    });
    return mapGrowth(created as GrowthMeasurementRowWithRecorder);
  }
}

// ── immunizations ────────────────────────────────────────────────────────

function mapImm(row: ImmunizationRowWithAdmin): ImmunizationResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    cvxCode: row.cvx_code,
    vaccineName: row.vaccine_name,
    manufacturer: row.manufacturer,
    seriesName: row.series_name,
    doseNumber: row.dose_number,
    seriesDoses: row.series_doses,
    administeredDate: row.administered_date,
    lotNumber: row.lot_number,
    expirationDate: row.expiration_date,
    site: (row.site ?? null) as ImmunizationResponse['site'],
    route: (row.route ?? null) as ImmunizationResponse['route'],
    doseQuantityMl: num(row.dose_quantity_ml),
    status: row.status as ImmunizationResponse['status'],
    notDoneReason: row.not_done_reason,
    note: row.note,
    administeredBy: row.administered_by,
    administeredByName: staffName(row.administered_by_given_name, row.administered_by_family_name),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class ImmunizationService {
  async listForPatient(clinicId: string, patientId: string): Promise<ImmunizationResponse[]> {
    const rows = await immunizationRepository.listForPatient(clinicId, patientId);
    return rows.map(mapImm);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateImmunizationDTO,
  ): Promise<ImmunizationResponse> {
    const created = await immunizationRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      cvx_code: dto.cvxCode,
      vaccine_name: dto.vaccineName,
      manufacturer: dto.manufacturer ?? null,
      series_name: dto.seriesName ?? null,
      dose_number: dto.doseNumber ?? null,
      series_doses: dto.seriesDoses ?? null,
      administered_date: dto.administeredDate,
      lot_number: dto.lotNumber ?? null,
      expiration_date: dto.expirationDate ?? null,
      site: dto.site ?? null,
      route: dto.route ?? null,
      dose_quantity_ml: dto.doseQuantityMl != null ? String(dto.doseQuantityMl) : null,
      status: dto.status,
      not_done_reason: dto.notDoneReason ?? null,
      note: dto.note ?? null,
      administered_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'immunizations',
      recordId: created.id,
      newData: { cvx: created.cvx_code, vaccine: created.vaccine_name, date: created.administered_date },
    });
    return mapImm(created as ImmunizationRowWithAdmin);
  }
}

// ── milestones ───────────────────────────────────────────────────────────

function mapMilestone(row: MilestoneRowWithAssessor): MilestoneResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    domain: row.domain as MilestoneResponse['domain'],
    milestone: row.milestone,
    expectedAgeMonths: row.expected_age_months,
    achievedAtMonths: row.achieved_at_months,
    status: row.status as MilestoneResponse['status'],
    note: row.note,
    assessedAt: toIso(row.assessed_at)!,
    assessedBy: row.assessed_by,
    assessedByName: staffName(row.assessed_by_given_name, row.assessed_by_family_name),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class MilestoneService {
  async listForPatient(clinicId: string, patientId: string): Promise<MilestoneResponse[]> {
    const rows = await milestoneRepository.listForPatient(clinicId, patientId);
    return rows.map(mapMilestone);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreateMilestoneDTO,
  ): Promise<MilestoneResponse> {
    const created = await milestoneRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      domain: dto.domain,
      milestone: dto.milestone,
      expected_age_months: dto.expectedAgeMonths ?? null,
      achieved_at_months: dto.achievedAtMonths ?? null,
      status: dto.status,
      note: dto.note ?? null,
      assessed_at: new Date(),
      assessed_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'developmental_milestones',
      recordId: created.id,
      newData: { domain: created.domain, milestone: created.milestone, status: created.status },
    });
    return mapMilestone(created as MilestoneRowWithAssessor);
  }
}

export const growthMeasurementService = new GrowthMeasurementService();
export const immunizationService = new ImmunizationService();
export const milestoneService = new MilestoneService();
