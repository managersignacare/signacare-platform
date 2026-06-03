import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import { BaseRepository } from '../../shared/repositories/BaseRepository';
import type { LaiScheduleCreateDTO, LaiScheduleUpdateDTO } from '@signacare/shared';

export interface LaiScheduleRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  drug_product_id: string | null;
  prescriber_staff_id: string;
  drug_name: string;
  dose_mg: string;
  frequency_days: number;
  injection_site: string;
  injection_technique: string;
  needle_gauge: string | null;
  indication: string | null;
  loading_dose_required: boolean;
  loading_doses_required: number;
  loading_doses_given: number;
  oral_overlap_required: boolean;
  oral_overlap_end_date: string | null;
  start_date: string;
  first_due_date: string;
  next_due_date: string | null;
  last_given_date: string | null;
  end_date: string | null;
  baseline_aims_score: number | null;
  last_aims_date: string | null;
  next_aims_due_date: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Phase 0.7.5 c24 D12 — explicit .returning() column list matching
// LaiScheduleRow + DB (verified via schema-snapshot.json).
const LAI_SCHEDULE_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'episode_id', 'drug_product_id',
  'prescriber_staff_id', 'drug_name', 'dose_mg', 'frequency_days',
  'injection_site', 'injection_technique', 'needle_gauge', 'indication',
  'loading_dose_required', 'loading_doses_required', 'loading_doses_given',
  'oral_overlap_required', 'oral_overlap_end_date', 'start_date',
  'first_due_date', 'next_due_date', 'last_given_date', 'end_date',
  'baseline_aims_score', 'last_aims_date', 'next_aims_due_date', 'status',
  'notes', 'created_at', 'updated_at', 'deleted_at',
] as const;

export class LaiScheduleRepository extends BaseRepository<LaiScheduleRow> {
  constructor() {
    super('lai_schedules');
  }

  async create(
    clinicId: string,
    dto: LaiScheduleCreateDTO,
  ): Promise<LaiScheduleRow> {
    const [row] = await db('lai_schedules')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        drug_product_id: dto.drugProductId ?? null,
        prescriber_staff_id: dto.prescriberStaffId,
        drug_name: dto.drugName,
        dose_mg: dto.doseMg,
        frequency_days: dto.frequencyDays ?? 28,
        injection_site: dto.injectionSite ?? 'gluteal',
        injection_technique: dto.injectionTechnique ?? 'IM',
        needle_gauge: dto.needleGauge ?? null,
        indication: dto.indication ?? null,
        loading_dose_required: dto.loadingDoseRequired ?? false,
        loading_doses_required: dto.loadingDosesRequired ?? 0,
        loading_doses_given: 0,
        oral_overlap_required: dto.oralOverlapRequired ?? false,
        oral_overlap_end_date: dto.oralOverlapEndDate ?? null,
        start_date: dto.startDate,
        first_due_date: dto.firstDueDate,
        next_due_date: dto.firstDueDate,
        last_given_date: null,
        end_date: null,
        baseline_aims_score: null,
        last_aims_date: null,
        next_aims_due_date: null,
        status: 'active',
        notes: dto.notes ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(LAI_SCHEDULE_COLUMNS) as LaiScheduleRow[];
    return row;
  }

  async findByPatient(
    clinicId: string,
    patientId: string,
    statusFilter?: string,
  ): Promise<LaiScheduleRow[]> {
    const q = db('lai_schedules')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('next_due_date', 'asc');
    if (statusFilter) q.where('status', statusFilter);
    return q as Promise<LaiScheduleRow[]>;
  }

  async findByClinic(
    clinicId: string,
    statusFilter = 'active',
  ): Promise<LaiScheduleRow[]> {
    return db('lai_schedules')
      .where({ clinic_id: clinicId, status: statusFilter })
      .whereNull('deleted_at')
      .orderBy('next_due_date', 'asc') as Promise<LaiScheduleRow[]>;
  }

  async findCurrentActiveByClinic(
    clinicId: string,
  ): Promise<LaiScheduleRow[]> {
    return db('lai_schedules')
      .where({ clinic_id: clinicId, status: 'active' })
      .whereNull('deleted_at')
      .where(function whereCurrentSchedule() {
        this.whereNull('end_date')
          .orWhere('end_date', '>=', db.raw('CURRENT_DATE'));
      })
      .orderBy('next_due_date', 'asc') as Promise<LaiScheduleRow[]>;
  }

  async update(
    id: string,
    clinicId: string,
    dto: LaiScheduleUpdateDTO,
  ): Promise<LaiScheduleRow | undefined> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (dto.doseMg !== undefined) updates.dose_mg = dto.doseMg;
    if (dto.frequencyDays !== undefined) updates.frequency_days = dto.frequencyDays;
    if (dto.injectionSite !== undefined) updates.injection_site = dto.injectionSite;
    if (dto.injectionTechnique !== undefined)
      updates.injection_technique = dto.injectionTechnique;
    if (dto.needleGauge !== undefined) updates.needle_gauge = dto.needleGauge;
    if (dto.oralOverlapRequired !== undefined)
      updates.oral_overlap_required = dto.oralOverlapRequired;
    if (dto.oralOverlapEndDate !== undefined)
      updates.oral_overlap_end_date = dto.oralOverlapEndDate;
    if (dto.nextAimsDueDate !== undefined)
      updates.next_aims_due_date = dto.nextAimsDueDate;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    const [row] = await db('lai_schedules')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update(updates)
      .returning(LAI_SCHEDULE_COLUMNS) as LaiScheduleRow[];
    return row;
  }

  async advanceSchedule(
    id: string,
    clinicId: string,
    lastGivenDate: string,
    nextDueDate: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    await (trx ?? db)('lai_schedules')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({
        last_given_date: lastGivenDate,
        next_due_date: nextDueDate,
        updated_at: new Date(),
      });
  }

  async incrementLoadingDose(
    id: string,
    clinicId: string,
    trx?: Knex.Transaction,
  ): Promise<void> {
    const q = trx ?? db;
    await q('lai_schedules')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({
        loading_doses_given: q.raw('loading_doses_given + 1'),
        updated_at: new Date(),
      });
  }

  async updateAimsTracking(
    id: string,
    clinicId: string,
    score: number,
    assessmentDate: string,
    nextAimsDue: string,
  ): Promise<void> {
    await db('lai_schedules')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({
        last_aims_date: assessmentDate,
        next_aims_due_date: nextAimsDue,
        updated_at: new Date(),
      });
    // Only set baseline score once (first AIMS)
    await db('lai_schedules')
      .where({ id, clinic_id: clinicId, baseline_aims_score: null })
      .update({ baseline_aims_score: score });
  }
}

export const laiScheduleRepository = new LaiScheduleRepository();
