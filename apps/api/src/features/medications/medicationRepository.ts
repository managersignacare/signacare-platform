import { v4 as uuidv4 } from 'uuid';
import { db } from '../../db/db';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';

// MedicationRow now matches the real patient_medications schema
// (verified via psql + information_schema, 32 columns). Pre-R2 the
// interface declared 8 ghost fields (medication_name, is_clozapine,
// is_s8, lai_frequency, lai_next_due, lai_last_admin, prescribed_at,
// prescriber) that DON'T EXIST as columns. The .insert/.update calls
// wrote to those ghost columns and Knex silently dropped them.
//
// Phase R3 reconciliation:
//   - medication_name → drug_label (rename)
//   - prescribed_at   → start_date (rename)
//   - prescriber      → DROPPED (string field; the real column is
//                                prescribed_by_staff_id (uuid). DTOs
//                                that need to record a prescriber name
//                                should pass the staff UUID instead;
//                                separate followup to update DTOs.)
//   - is_clozapine    → DROPPED (no column; the LAI/clozapine subprogram
//                                lives in dedicated tables. Code that
//                                needs to identify clozapine should
//                                check drug_code or category='clozapine'.)
//   - is_s8           → DROPPED (no column; S8 status determined by drug
//                                class lookup, not a per-row flag)
//   - lai_*           → DROPPED (no columns; LAI scheduling lives in
//                                dedicated lai_schedules table)
export interface MedicationRow {
  id: string;
  patient_id: string;
  clinic_id: string;
  episode_id: string | null;
  drug_product_id: string | null;
  drug_code: string | null;
  drug_label: string;
  generic_name: string | null;
  brand_name: string | null;
  dose: string;
  dose_unit: string | null;
  route: string;
  frequency: string;
  instructions: string | null;
  indication: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string;
  reason_for_cessation: string | null;
  is_regular: boolean;
  is_prn: boolean;
  is_lai: boolean;
  taper_schedule: unknown | null;
  source: string | null;
  prescribed_by_staff_id: string | null;
  recorded_by_staff_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  prescribed_by_specialty_code: string | null;
  category: string | null;
  lock_version: number;
}

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: matches MedicationRow + real patient_medications schema.
const MEDICATION_COLUMNS = [
  'id',
  'patient_id',
  'clinic_id',
  'episode_id',
  'drug_product_id',
  'drug_code',
  'drug_label',
  'generic_name',
  'brand_name',
  'dose',
  'dose_unit',
  'route',
  'frequency',
  'instructions',
  'indication',
  'start_date',
  'end_date',
  'status',
  'reason_for_cessation',
  'is_regular',
  'is_prn',
  'is_lai',
  'taper_schedule',
  'source',
  'prescribed_by_staff_id',
  'recorded_by_staff_id',
  'notes',
  'created_at',
  'updated_at',
  'deleted_at',
  'prescribed_by_specialty_code',
  'category',
  'lock_version',
] as const;

const TABLE = 'patient_medications';

export const medicationRepository = {
  async create(
    clinicId: string,
    dto: {
      patientId: string;
      episodeId?: string | null;
      medicationName: string;
      genericName?: string;
      dose: string;
      frequency: string;
      route?: string;
      isLai?: boolean;
      isClozapine?: boolean;
      isS8?: boolean;
      laiFrequency?: string;
      prescriber?: string;
      indication?: string;
      notes?: string;
      prescribedBySpecialtyCode?: string | null;
      category?: string | null;
      prescribedByStaffId?: string | null;
      recordedByStaffId?: string | null;
    },
  ): Promise<MedicationRow> {
    // Map DTO → real DB columns (Phase R3 — see MedicationRow comment
    // for the rename / drop list).
    const [row] = await db(TABLE)
      .insert({
        id: uuidv4(),
        clinic_id: clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        drug_label: dto.medicationName,
        generic_name: dto.genericName ?? null,
        dose: dto.dose,
        frequency: dto.frequency,
        route: dto.route ?? 'oral',
        status: 'active',
        is_lai: dto.isLai ?? false,
        // is_clozapine / is_s8 / lai_frequency / prescriber are silently
        // dropped — no canonical home. Identification of clozapine vs S8
        // happens via drug_code / category lookup, LAI scheduling lives
        // in lai_schedules. The DTO accepts these for backward compat
        // but they don't persist.
        start_date: new Date().toISOString().slice(0, 10),
        indication: dto.indication ?? null,
        // BUG-040 — persist prescriber attribution. Without this the
        // DB-level discipline trigger is decorative (NULL is allowed
        // for legacy rows). Service-layer populates from auth.staffId
        // so every NEW prescription has a traceable AHPRA-eligible
        // prescriber. L4 review absorption.
        prescribed_by_staff_id: dto.prescribedByStaffId ?? null,
        recorded_by_staff_id: dto.recordedByStaffId ?? null,
        prescribed_by_specialty_code: dto.prescribedBySpecialtyCode ?? null,
        category: dto.category ?? null,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(MEDICATION_COLUMNS) as MedicationRow[];
    return row;
  },

  async findByPatient(
    clinicId: string,
    patientId: string,
    statusFilter?: string,
  ): Promise<MedicationRow[]> {
    const q = db(TABLE)
      .where({ clinic_id: clinicId, patient_id: patientId })
      .orderBy('created_at', 'desc');
    if (statusFilter) q.where('status', statusFilter);
    return q as Promise<MedicationRow[]>;
  },

  async findById(id: string, clinicId: string): Promise<MedicationRow | null> {
    const row = await db(TABLE)
      .where({ id, clinic_id: clinicId })
      .first() as MedicationRow | undefined;
    return row ?? null;
  },

  async update(
    id: string,
    clinicId: string,
    changes: Record<string, unknown>,
    expectedLockVersion: number,
  ): Promise<MedicationRow> {
    // BUG-371b — opt-locked. Map DTO → real DB columns; silently drop
    // fields with no canonical home (isClozapine, isS8, laiFrequency,
    // prescriber) — see MedicationRow comment block. Helper sets
    // lock_version + updated_at canonically; caller must NOT supply.
    // BUG-554 defence-in-depth (L2 belt below the controller's Zod L1) —
    // refuse `status='ceased'` at the repository layer. Cessations MUST
    // route through `cease()` below, which atomically writes endDate +
    // reasonForCessation per AHPRA Standard 1. A direct
    // `repository.update({ status: 'ceased' })` would silently drop those
    // columns, recreating the gap that BUG-371b absorb-1 + BUG-554 close.
    if (changes.status === 'ceased') {
      throw new Error(
        'medicationRepository.update: status="ceased" is forbidden — use cease() with endDate + reasonForCessation per BUG-554',
      );
    }
    const patch: Record<string, unknown> = {};
    if (changes.medicationName !== undefined) patch['drug_label'] = changes.medicationName;
    if (changes.genericName !== undefined) patch['generic_name'] = changes.genericName;
    if (changes.dose !== undefined) patch['dose'] = changes.dose;
    if (changes.frequency !== undefined) patch['frequency'] = changes.frequency;
    if (changes.route !== undefined) patch['route'] = changes.route;
    if (changes.isLai !== undefined) patch['is_lai'] = changes.isLai;
    if (changes.status !== undefined) patch['status'] = changes.status;
    if (Object.keys(patch).length === 0) {
      // No mappable fields — nothing to update. Helper would reject
      // empty patch; caller already has the unchanged row.
      throw new Error('BUG-371b: medicationRepository.update called with no mappable changes');
    }
    return updateWithOptimisticLock<MedicationRow>({
      table: TABLE,
      where: { id, clinic_id: clinicId },
      expectedLockVersion,
      patch,
      returning: MEDICATION_COLUMNS,
    });
  },

  async cease(
    id: string,
    clinicId: string,
    dto: { endDate: string; reasonForCessation: string },
    expectedLockVersion: number,
  ): Promise<MedicationRow> {
    // BUG-371b — opt-locked cease. Highest concurrency-risk path:
    // multiple clinicians may attempt to cease during handover.
    // BUG-371b absorb-1 (L4 Rule 4): persist endDate + reason; pre-
    // absorb these were silently dropped — AHPRA forensic gap.
    return updateWithOptimisticLock<MedicationRow>({
      table: TABLE,
      where: { id, clinic_id: clinicId },
      expectedLockVersion,
      patch: {
        status: 'ceased',
        end_date: dto.endDate,
        reason_for_cessation: dto.reasonForCessation,
      },
      returning: MEDICATION_COLUMNS,
    });
  },

  async softDelete(id: string, clinicId: string): Promise<void> {
    await db(TABLE).where({ id, clinic_id: clinicId }).whereNull('deleted_at').update({ deleted_at: new Date(), updated_at: new Date() });
  },
};
