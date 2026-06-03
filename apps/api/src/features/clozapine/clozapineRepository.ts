import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import { BaseRepository } from '../../shared/repositories/BaseRepository';
import type {
  ClozapineRegistrationCreateDTO,
  ClozapineRegistrationUpdateDTO,
  ClozapineBloodResultCreateDTO,
} from '@signacare/shared';
// Phase 0b.2c-batch-2 (2026-05-06): drain hand-written clozapine column
// constants to migration-driven SSoT per Phase 0b.2 plan + CLAUDE.md §15.
//
// permanent: alias re-exports below ARE the end-state for Phase 0b.2's
// DoD ("0 remaining hand-written *_COLUMNS array literals"). The runtime
// constants resolve to the migration-driven SSoT, so when a future
// migration adds a column to any of these 6 clozapine tables (NIMC-
// compliant clozapine workflow per BUG-040 / BUG-292 / BUG-293
// prescriber-discipline barrier), the aliases update automatically and
// downstream `.returning(<CONST>)` calls receive the new column without
// silent drift. No consumer-rename concern (all 6 constants are
// local-scope / no external imports). Clinical-safety HAZARD-class
// surface — L4 clinical-safety-reviewer verdict cited in commit body
// (mandatory gate per Phase 0b.2c-batch-2 plan entry, not N/A).
import { CLOZAPINE_REGISTRATIONS_COLUMNS } from '../../db/types/clozapine_registrations';
import { CLOZAPINE_BLOOD_RESULTS_COLUMNS } from '../../db/types/clozapine_blood_results';
import { CLOZAPINE_TITRATION_DAYS_COLUMNS } from '../../db/types/clozapine_titration_days';
import { CLOZAPINE_ADMINISTRATIONS_COLUMNS } from '../../db/types/clozapine_administrations';
import { CLOZAPINE_OBSERVATIONS_COLUMNS } from '../../db/types/clozapine_observations';
import { CLOZAPINE_MONITORING_CHECKS_COLUMNS } from '../../db/types/clozapine_monitoring_checks';

export interface ClozapineRegistrationRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  episode_id: string | null;
  drug_product_id: string | null;
  prescriber_staff_id: string | null;
  registration_date: string;
  dispenser_pharmacy: string | null;
  current_dose_mg: number | null;
  titration_phase: string;
  monitoring_week: number | null;
  monitoring_frequency: string;
  last_anc_date: string | null;
  last_anc_value: number | null;
  anc_status: string;
  last_wbc_date: string | null;
  last_wbc_value: number | null;
  next_blood_due_date: string | null;
  physical_health_check_due: string | null;
  ceased_date: string | null;
  ceased_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ClozapineBloodResultRow {
  id: string;
  clinic_id: string;
  patient_id: string;
  registration_id: string;
  recorded_by_staff_id: string;
  collection_date: string;
  resulted_date: string | null;
  anc_value: number | null;
  wbc_value: number | null;
  neutrophils_pct: number | null;
  anc_status: string;
  flag_raised: boolean;
  flag_type: string | null;
  lab_name: string | null;
  lab_reference: string | null;
  clinical_notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// Phase 0.7.5 c24 D3 — previously these four tables had no Row interface.
// Methods returned implicitly-typed `any` which defeated the drift guard.
// Column lists verified against schema-snapshot.json on 2026-04-17.
export interface ClozapineTitrationDayRow {
  id: string;
  clinic_id: string;
  registration_id: string;
  day_number: number;
  titration_date: string;
  morning_dose_mg: number | null;
  evening_dose_mg: number | null;
  prescriber_initials: string | null;
  prescribed_by_staff_id: string;
  comments: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ClozapineAdministrationRow {
  id: string;
  clinic_id: string;
  registration_id: string;
  titration_day_id: string | null;
  administration_date: string;
  time_slot: string;
  actual_time: string | null;
  dose_mg: number;
  administered: boolean;
  non_admin_code: string | null;
  administered_by_staff_id: string;
  administrator_initials: string | null;
  notes: string | null;
  created_at: Date;
}

export interface ClozapineObservationRow {
  id: string;
  clinic_id: string;
  registration_id: string;
  observation_date: string;
  observation_time: string | null;
  temperature: number | null;
  pulse: number | null;
  bp_systolic_lying: number | null;
  bp_diastolic_lying: number | null;
  bp_systolic_standing: number | null;
  bp_diastolic_standing: number | null;
  respiration_rate: number | null;
  smoking_status: string | null;
  cigarettes_per_day: number | null;
  outside_normal: boolean;
  notes: string | null;
  recorded_by_staff_id: string;
  created_at: Date;
}

export interface ClozapineMonitoringCheckRow {
  id: string;
  clinic_id: string;
  registration_id: string;
  investigation: string;
  check_point: string;
  check_date: string | null;
  result_status: string | null;
  result_value: string | null;
  notes: string | null;
  recorded_by_staff_id: string;
  created_at: Date;
}

// Phase 0.7.5 c24 D3 — explicit column lists for every .returning call.
// Matches the interfaces above, which match the DB. One source of truth.
//
// Phase 0b.2c-batch-2 (2026-05-06): aliases of auto-generated SSoT (see
// import block + permanent rationale at top of file).
const CLOZAPINE_REGISTRATION_COLUMNS = CLOZAPINE_REGISTRATIONS_COLUMNS;
const CLOZAPINE_BLOOD_RESULT_COLUMNS = CLOZAPINE_BLOOD_RESULTS_COLUMNS;
const CLOZAPINE_TITRATION_DAY_COLUMNS = CLOZAPINE_TITRATION_DAYS_COLUMNS;
const CLOZAPINE_ADMINISTRATION_COLUMNS = CLOZAPINE_ADMINISTRATIONS_COLUMNS;
const CLOZAPINE_OBSERVATION_COLUMNS = CLOZAPINE_OBSERVATIONS_COLUMNS;
const CLOZAPINE_MONITORING_CHECK_COLUMNS = CLOZAPINE_MONITORING_CHECKS_COLUMNS;

export class ClozapineRepository extends BaseRepository<ClozapineRegistrationRow> {
  constructor() {
    super('clozapine_registrations');
  }

  async createRegistration(
    clinicId: string,
    dto: ClozapineRegistrationCreateDTO,
  ): Promise<ClozapineRegistrationRow> {
    const [row] = await db('clozapine_registrations')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        drug_product_id: dto.drugProductId ?? null,
        prescriber_staff_id: dto.prescriberStaffId ?? null,
        registration_date: dto.registrationDate,
        dispenser_pharmacy: dto.dispenserPharmacy ?? null,
        current_dose_mg: dto.currentDoseMg ?? null,
        titration_phase: dto.titrationPhase ?? 'initiation',
        monitoring_week: 1,
        monitoring_frequency: dto.monitoringFrequency ?? 'weekly',
        anc_status: 'unknown',
        notes: dto.notes ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(CLOZAPINE_REGISTRATION_COLUMNS) as ClozapineRegistrationRow[];
    return row;
  }

  async findByPatient(
    clinicId: string,
    patientId: string,
  ): Promise<ClozapineRegistrationRow[]> {
    return db('clozapine_registrations')
      .where({ clinic_id: clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('registration_date', 'desc') as Promise<ClozapineRegistrationRow[]>;
  }

  async findActiveByClinic(
    clinicId: string,
  ): Promise<ClozapineRegistrationRow[]> {
    return db('clozapine_registrations')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .whereNot('titration_phase', 'ceased')
      .where(function whereCurrentRegistration() {
        this.whereNull('ceased_date')
          .orWhere('ceased_date', '>=', db.raw('CURRENT_DATE'));
      })
      .orderBy('next_blood_due_date', 'asc')
      .orderBy('registration_date', 'desc') as Promise<ClozapineRegistrationRow[]>;
  }

  async updateRegistration(
    id: string,
    clinicId: string,
    dto: ClozapineRegistrationUpdateDTO,
  ): Promise<ClozapineRegistrationRow | undefined> {
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (dto.dispenserPharmacy !== undefined) updates.dispenser_pharmacy = dto.dispenserPharmacy;
    if (dto.currentDoseMg !== undefined) updates.current_dose_mg = dto.currentDoseMg;
    if (dto.titrationPhase !== undefined) updates.titration_phase = dto.titrationPhase;
    if (dto.monitoringFrequency !== undefined) updates.monitoring_frequency = dto.monitoringFrequency;
    if (dto.nextBloodDueDate !== undefined) updates.next_blood_due_date = dto.nextBloodDueDate;
    if (dto.physicalHealthCheckDue !== undefined) updates.physical_health_check_due = dto.physicalHealthCheckDue;
    if (dto.ceasedDate !== undefined) updates.ceased_date = dto.ceasedDate;
    if (dto.ceasedReason !== undefined) updates.ceased_reason = dto.ceasedReason;
    if (dto.notes !== undefined) updates.notes = dto.notes;
    const [row] = await db('clozapine_registrations')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update(updates)
      .returning(CLOZAPINE_REGISTRATION_COLUMNS) as ClozapineRegistrationRow[];
    return row;
  }

  async syncLatestAnc(
    id: string,
    clinicId: string,
    ancDate: string,
    ancValue: number,
    wbcDate: string | null,
    wbcValue: number | null,
    ancStatus: string,
    nextBloodDue: string,
  ): Promise<void> {
    await db('clozapine_registrations')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({
        last_anc_date: ancDate,
        last_anc_value: ancValue,
        anc_status: ancStatus,
        last_wbc_date: wbcDate,
        last_wbc_value: wbcValue,
        next_blood_due_date: nextBloodDue,
        monitoring_week: db.raw('monitoring_week + 1'),
        updated_at: new Date(),
      });
  }

  async createBloodResult(
    clinicId: string,
    staffId: string,
    dto: ClozapineBloodResultCreateDTO,
    ancStatus: string,
    flagRaised: boolean,
    flagType: string | null,
  ): Promise<ClozapineBloodResultRow> {
    const [row] = await db('clozapine_blood_results')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        registration_id: dto.registrationId,
        recorded_by_staff_id: staffId,
        collection_date: dto.collectionDate,
        resulted_date: dto.resultedDate ?? null,
        anc_value: dto.ancValue ?? null,
        wbc_value: dto.wbcValue ?? null,
        neutrophils_pct: dto.neutrophilsPct ?? null,
        anc_status: ancStatus,
        flag_raised: flagRaised,
        flag_type: flagType,
        lab_name: dto.labName ?? null,
        lab_reference: dto.labReference ?? null,
        clinical_notes: dto.clinicalNotes ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(CLOZAPINE_BLOOD_RESULT_COLUMNS) as ClozapineBloodResultRow[];
    return row;
  }

  async findBloodResults(
    clinicId: string,
    registrationId: string,
    limit = 30,
  ): Promise<ClozapineBloodResultRow[]> {
    return db('clozapine_blood_results')
      .where({ clinic_id: clinicId, registration_id: registrationId })
      .whereNull('deleted_at')
      .orderBy('collection_date', 'desc')
      .limit(limit) as Promise<ClozapineBloodResultRow[]>;
  }
  // ── Titration Days ────────────────────────────────────────────────────────
  async createTitrationDay(
    clinicId: string,
    staffId: string,
    dto: { registrationId: string; dayNumber: number; titrationDate: string; morningDoseMg?: number; eveningDoseMg?: number; prescriberInitials?: string; comments?: string },
  ): Promise<ClozapineTitrationDayRow> {
    const rows = await db<ClozapineTitrationDayRow>('clozapine_titration_days')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        registration_id: dto.registrationId,
        day_number: dto.dayNumber,
        titration_date: dto.titrationDate,
        morning_dose_mg: dto.morningDoseMg ?? null,
        evening_dose_mg: dto.eveningDoseMg ?? null,
        prescriber_initials: dto.prescriberInitials ?? null,
        prescribed_by_staff_id: staffId,
        comments: dto.comments ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(CLOZAPINE_TITRATION_DAY_COLUMNS) as ClozapineTitrationDayRow[];
    return rows[0];
  }

  async findTitrationDays(
    clinicId: string,
    registrationId: string,
  ): Promise<ClozapineTitrationDayRow[]> {
    return db<ClozapineTitrationDayRow>('clozapine_titration_days')
      .where({ clinic_id: clinicId, registration_id: registrationId })
      .orderBy('day_number', 'asc');
  }

  async upsertTitrationDay(
    clinicId: string,
    staffId: string,
    dto: { registrationId: string; dayNumber: number; titrationDate: string; morningDoseMg?: number; eveningDoseMg?: number; prescriberInitials?: string; comments?: string },
  ): Promise<ClozapineTitrationDayRow> {
    // CLAUDE.md §1.3 — scope the existing-row lookup by clinic_id so
    // the fallback is defence-in-depth against RLS misconfig.
    const existing = await db<ClozapineTitrationDayRow>('clozapine_titration_days')
      .where({
        clinic_id: clinicId,
        registration_id: dto.registrationId,
        day_number: dto.dayNumber,
      })
      .first();
    if (existing) {
      const rows = await db<ClozapineTitrationDayRow>('clozapine_titration_days')
        .where({ id: existing.id, clinic_id: clinicId })
        .update({
          morning_dose_mg: dto.morningDoseMg ?? existing.morning_dose_mg,
          evening_dose_mg: dto.eveningDoseMg ?? existing.evening_dose_mg,
          prescriber_initials: dto.prescriberInitials ?? existing.prescriber_initials,
          prescribed_by_staff_id: staffId,
          comments: dto.comments ?? existing.comments,
          updated_at: new Date(),
        })
        .returning(CLOZAPINE_TITRATION_DAY_COLUMNS) as ClozapineTitrationDayRow[];
      return rows[0];
    }
    return this.createTitrationDay(clinicId, staffId, dto);
  }

  // ── Administrations ────────────────────────────────────────────────────────
  async createAdministration(
    clinicId: string,
    staffId: string,
    dto: { registrationId: string; titrationDayId?: string; administrationDate: string; timeSlot: string; actualTime?: string; doseMg: number; administered: boolean; nonAdminCode?: string; administratorInitials?: string; notes?: string },
  ): Promise<ClozapineAdministrationRow> {
    const rows = await db<ClozapineAdministrationRow>('clozapine_administrations')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        registration_id: dto.registrationId,
        titration_day_id: dto.titrationDayId ?? null,
        administration_date: dto.administrationDate,
        time_slot: dto.timeSlot,
        actual_time: dto.actualTime ?? null,
        dose_mg: dto.doseMg,
        administered: dto.administered,
        non_admin_code: dto.nonAdminCode ?? null,
        administered_by_staff_id: staffId,
        administrator_initials: dto.administratorInitials ?? null,
        notes: dto.notes ?? null,
        created_at: new Date(),
      })
      .returning(CLOZAPINE_ADMINISTRATION_COLUMNS) as ClozapineAdministrationRow[];
    return rows[0];
  }

  async findAdministrations(
    clinicId: string,
    registrationId: string,
    limit = 60,
  ): Promise<ClozapineAdministrationRow[]> {
    return db<ClozapineAdministrationRow>('clozapine_administrations')
      .where({ clinic_id: clinicId, registration_id: registrationId })
      .orderBy('administration_date', 'desc')
      .orderBy('time_slot', 'asc')
      .limit(limit);
  }

  // ── Observations ───────────────────────────────────────────────────────────
  async createObservation(
    clinicId: string,
    staffId: string,
    dto: { registrationId: string; observationDate: string; observationTime?: string; temperature?: number; pulse?: number; bpSystolicLying?: number; bpDiastolicLying?: number; bpSystolicStanding?: number; bpDiastolicStanding?: number; respirationRate?: number; smokingStatus?: string; cigarettesPerDay?: number; outsideNormal?: boolean; notes?: string },
  ): Promise<ClozapineObservationRow> {
    const rows = await db<ClozapineObservationRow>('clozapine_observations')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        registration_id: dto.registrationId,
        observation_date: dto.observationDate,
        observation_time: dto.observationTime ?? null,
        temperature: dto.temperature ?? null,
        pulse: dto.pulse ?? null,
        bp_systolic_lying: dto.bpSystolicLying ?? null,
        bp_diastolic_lying: dto.bpDiastolicLying ?? null,
        bp_systolic_standing: dto.bpSystolicStanding ?? null,
        bp_diastolic_standing: dto.bpDiastolicStanding ?? null,
        respiration_rate: dto.respirationRate ?? null,
        smoking_status: dto.smokingStatus ?? null,
        cigarettes_per_day: dto.cigarettesPerDay ?? null,
        outside_normal: dto.outsideNormal ?? false,
        notes: dto.notes ?? null,
        recorded_by_staff_id: staffId,
        created_at: new Date(),
      })
      .returning(CLOZAPINE_OBSERVATION_COLUMNS) as ClozapineObservationRow[];
    return rows[0];
  }

  async findObservations(
    clinicId: string,
    registrationId: string,
    limit = 60,
  ): Promise<ClozapineObservationRow[]> {
    return db<ClozapineObservationRow>('clozapine_observations')
      .where({ clinic_id: clinicId, registration_id: registrationId })
      .orderBy('observation_date', 'desc')
      .limit(limit);
  }

  // ── Monitoring Checks ──────────────────────────────────────────────────────
  async upsertMonitoringCheck(
    clinicId: string,
    staffId: string,
    dto: { registrationId: string; investigation: string; checkPoint: string; checkDate?: string; resultStatus?: string; resultValue?: string; notes?: string },
  ): Promise<ClozapineMonitoringCheckRow> {
    // CLAUDE.md §1.3 — existing-row lookup scoped by clinic_id.
    const existing = await db<ClozapineMonitoringCheckRow>('clozapine_monitoring_checks')
      .where({
        clinic_id: clinicId,
        registration_id: dto.registrationId,
        investigation: dto.investigation,
        check_point: dto.checkPoint,
      })
      .first();
    if (existing) {
      const rows = await db<ClozapineMonitoringCheckRow>('clozapine_monitoring_checks')
        .where({ id: existing.id, clinic_id: clinicId })
        .update({
          check_date: dto.checkDate ?? existing.check_date,
          result_status: dto.resultStatus ?? existing.result_status,
          result_value: dto.resultValue ?? existing.result_value,
          notes: dto.notes ?? existing.notes,
          recorded_by_staff_id: staffId,
        })
        .returning(CLOZAPINE_MONITORING_CHECK_COLUMNS) as ClozapineMonitoringCheckRow[];
      return rows[0];
    }
    const rows = await db<ClozapineMonitoringCheckRow>('clozapine_monitoring_checks')
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        registration_id: dto.registrationId,
        investigation: dto.investigation,
        check_point: dto.checkPoint,
        check_date: dto.checkDate ?? null,
        result_status: dto.resultStatus ?? null,
        result_value: dto.resultValue ?? null,
        notes: dto.notes ?? null,
        recorded_by_staff_id: staffId,
        created_at: new Date(),
      })
      .returning(CLOZAPINE_MONITORING_CHECK_COLUMNS) as ClozapineMonitoringCheckRow[];
    return rows[0];
  }

  async findMonitoringChecks(
    clinicId: string,
    registrationId: string,
  ): Promise<ClozapineMonitoringCheckRow[]> {
    return db<ClozapineMonitoringCheckRow>('clozapine_monitoring_checks')
      .where({ clinic_id: clinicId, registration_id: registrationId })
      .orderBy('investigation', 'asc')
      .orderBy('check_point', 'asc');
  }
}

export const clozapineRepository = new ClozapineRepository();
