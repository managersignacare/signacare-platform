// apps/api/src/features/obs-gyne/obsGyneServices.ts
//
// Multi-specialty Phase 6 — Obstetrics & Gynaecology: services.
//
// Orchestrates the pregnancy + antenatal-visit repositories, maps
// DB rows to shared response DTOs, auto-computes EDD from LMP via
// Naegele's rule when the caller omits it, and writes audit-log
// entries on every mutation.
import { AppError } from '../../shared/errors';
import {
  CreatePregnancyDTO,
  PregnancyResponse,
  CreateAntenatalVisitDTO,
  AntenatalVisitResponse,
  Gtpal,
  computeEddFromLmp,
} from '@signacare/shared';
import {
  pregnancyRepository,
  antenatalVisitRepository,
  type PregnancyRow,
  type PregnancyRowWithRecorder,
  type AntenatalVisitRow,
  type AntenatalVisitRowWithSeer,
} from './obsGyneRepositories';
import auditLogService from '../../utils/audit';

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : String(d);
}

function toDateOnly(d: Date | string | null | undefined): string {
  if (!d) return '';
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 10);
}

function num(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function staffName(given?: string | null, family?: string | null): string | null {
  return given && family ? `${given} ${family}` : null;
}

// ── Pregnancies ────────────────────────────────────────────────────────────

function mapPregnancy(row: PregnancyRowWithRecorder): PregnancyResponse {
  // gtpal is jsonb — pg returns it already parsed, but guard defensively.
  const gtpal = (typeof row.gtpal === 'string' ? JSON.parse(row.gtpal) : row.gtpal) as Gtpal;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    lmpDate: toDateOnly(row.lmp_date),
    eddDate: toDateOnly(row.edd_date),
    gtpal,
    status: row.status as PregnancyResponse['status'],
    note: row.note,
    recordedBy: row.recorded_by,
    recordedByName: staffName(row.recorded_by_given_name, row.recorded_by_family_name),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class PregnancyService {
  async listForPatient(clinicId: string, patientId: string): Promise<PregnancyResponse[]> {
    const rows = await pregnancyRepository.listForPatient(clinicId, patientId);
    return rows.map(mapPregnancy);
  }

  async create(
    clinicId: string,
    actorId: string,
    dto: CreatePregnancyDTO,
  ): Promise<PregnancyResponse> {
    const eddDate = dto.eddDate ?? computeEddFromLmp(dto.lmpDate);
    const created = await pregnancyRepository.create({
      clinic_id: clinicId,
      patient_id: dto.patientId,
      episode_id: dto.episodeId ?? null,
      lmp_date: dto.lmpDate,
      edd_date: eddDate,
      gtpal: dto.gtpal,
      status: dto.status ?? 'ongoing',
      note: dto.note ?? null,
      recorded_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'pregnancies',
      recordId: created.id,
      newData: { lmp: dto.lmpDate, edd: eddDate, status: created.status },
    });
    return mapPregnancy(created as PregnancyRowWithRecorder);
  }
}

// ── Antenatal visits ───────────────────────────────────────────────────────

function mapVisit(row: AntenatalVisitRowWithSeer): AntenatalVisitResponse {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    pregnancyId: row.pregnancy_id,
    patientId: row.patient_id,
    visitNumber: row.visit_number,
    visitDate: toDateOnly(row.visit_date),
    gaWeeks: row.ga_weeks,
    gaDays: row.ga_days,
    fundalHeightCm: num(row.fundal_height_cm),
    fetalHeartRateBpm: row.fetal_heart_rate_bpm,
    bpSystolic: row.bp_systolic,
    bpDiastolic: row.bp_diastolic,
    urineProtein: (row.urine_protein ?? null) as AntenatalVisitResponse['urineProtein'],
    urineGlucose: (row.urine_glucose ?? null) as AntenatalVisitResponse['urineGlucose'],
    oedema: row.oedema,
    note: row.note,
    seenBy: row.seen_by,
    seenByName: staffName(row.seen_by_given_name, row.seen_by_family_name),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

export class AntenatalVisitService {
  async listForPregnancy(
    clinicId: string,
    pregnancyId: string,
  ): Promise<AntenatalVisitResponse[]> {
    const rows = await antenatalVisitRepository.listForPregnancy(clinicId, pregnancyId);
    return rows.map(mapVisit);
  }

  async create(
    clinicId: string,
    actorId: string,
    pregnancyId: string,
    dto: CreateAntenatalVisitDTO,
  ): Promise<AntenatalVisitResponse> {
    // Resolve patient_id from the parent pregnancy so the denormalised
    // column stays in sync without trusting client-supplied ids.
    const pregnancy = await pregnancyRepository.findById(clinicId, pregnancyId);
    if (!pregnancy) {
      throw new AppError('Pregnancy not found', 404, 'NOT_FOUND');
    }
    const created = await antenatalVisitRepository.create({
      clinic_id: clinicId,
      pregnancy_id: pregnancyId,
      patient_id: pregnancy.patient_id,
      visit_number: dto.visitNumber,
      visit_date: dto.visitDate,
      ga_weeks: dto.gaWeeks,
      ga_days: dto.gaDays,
      fundal_height_cm: dto.fundalHeightCm ?? null,
      fetal_heart_rate_bpm: dto.fetalHeartRateBpm ?? null,
      bp_systolic: dto.bpSystolic ?? null,
      bp_diastolic: dto.bpDiastolic ?? null,
      urine_protein: dto.urineProtein ?? null,
      urine_glucose: dto.urineGlucose ?? null,
      oedema: dto.oedema ?? null,
      note: dto.note ?? null,
      seen_by: actorId,
    });
    await auditLogService.logCreate({
      clinicId,
      userId: actorId,
      tableName: 'antenatal_visits',
      recordId: created.id,
      newData: { visit_number: created.visit_number, ga: `${created.ga_weeks}+${created.ga_days}` },
    });
    return mapVisit(created as AntenatalVisitRowWithSeer);
  }
}

export const pregnancyService = new PregnancyService();
export const antenatalVisitService = new AntenatalVisitService();
// Helpers exported for test harnesses that construct rows directly.
export type { PregnancyRow, AntenatalVisitRow };
