// apps/api/src/features/appointments/appointmentRepository.ts
import { db } from '../../db/db';
import type { Knex } from 'knex';

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'in_session'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled';

/**
 * @schema-drift-exempt partial-shape
 * BUG-489 — AppointmentDb omits 13 real columns of the `appointments`
 * table (staff_id, type, telehealth_link, mode, mbs_item,
 * patient_response, location, duration_minutes, recurrence_rule,
 * recurrence_end_date, recurrence_parent_id, start_time, end_time).
 * BUG-529 reverse-direction guard surfaces these. BUG-489 is the work
 * item that closes the drift by surfacing the columns through the
 * appointment service / DTOs; until then, this annotation makes the
 * silencing LOUD and REVERSIBLE — removing the annotation is exactly
 * what BUG-489 will do.
 *
 * Cascade-discovery (BUG-529 surfacing): `staff_id` and `type` were
 * NOT enumerated in BUG-489's original column list; they are part of
 * BUG-489's scope from this commit forward.
 */
export interface AppointmentDb {
  id: string;
  clinic_id: string;
  patient_id: string;
  clinician_id: string | null;
  staff_id: string | null;
  episode_id: string | null;
  specialty_code: string | null;
  start_time: Date;
  end_time: Date;
  appointment_start: Date | null;
  appointment_end: Date | null;
  type: string;
  appointment_type: string | null;
  patient_response: 'attending' | 'not_attending' | null;
  status: AppointmentStatus;
  notes: string | null;
  telehealth: boolean;
  telehealth_url: string | null;
  cancellation_reason: string | null;
  cancelled_by_id: string | null;
  // BUG-458 — these 7 columns exist on the live `appointments` table
  // (verified via information_schema.columns 2026-04-25 and migration
  // 20260701000000_baseline.ts:4708-4717). The pre-fix interface
  // omitted them; pre-fix `appointmentService.mapDbToResponse` then
  // hardcoded null/false for the wire shape — silently dropping
  // reminder-delivery, reschedule-lineage, telehealth-provider, and
  // outlook-sync state. Widened so the mapper can read real values.
  telehealth_provider: string | null;
  telehealth_passcode: string | null;
  rescheduled_from_id: string | null;
  reminder_scheduled: boolean;
  reminder_sent: boolean;
  reminder_sent_at: Date | null;
  outlook_event_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AppointmentListFilters {
  clinicId: string;
  patientId?: string;
  clinicianId?: string;
  specialtyCode?: string;
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

// Phase 0.7.5 c24 D1 — the repository's API contract is the
// `AppointmentDb` interface. BUG-458 added telehealth-provider,
// reschedule-lineage, reminder-flags, and outlook-event-id columns
// to this list because the pre-fix subset stripped them on
// `.returning(...)` for create/update paths, leaving the mapper no
// data to read.
//
// Knex types .returning(arr) as Partial<T>[] even when the array is
// complete, so each call casts to AppointmentDb[] to preserve the
// declared return type.
const APPOINTMENT_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'clinician_id',
  'staff_id',
  'episode_id',
  'specialty_code',
  'start_time',
  'end_time',
  'appointment_start',
  'appointment_end',
  'type',
  'appointment_type',
  'patient_response',
  'status',
  'notes',
  'telehealth',
  'telehealth_url',
  'cancellation_reason',
  'cancelled_by_id',
  // BUG-458 — return real DB columns instead of stripping them.
  'telehealth_provider',
  'telehealth_passcode',
  'rescheduled_from_id',
  'reminder_scheduled',
  'reminder_sent',
  'reminder_sent_at',
  'outlook_event_id',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export const appointmentRepository = {
  async create(
    trx: Knex.Transaction | Knex = db,
    // BUG-458 — the 7 widened columns are either DB-default-valued
    // (reminder_scheduled, reminder_sent default false) or nullable
    // (telehealth_provider, telehealth_passcode, rescheduled_from_id,
    // reminder_sent_at, outlook_event_id), so callers don't have to
    // supply them on create.
    row: Omit<
      AppointmentDb,
      | 'id'
      | 'created_at'
      | 'updated_at'
      | 'deleted_at'
      | 'telehealth_provider'
      | 'telehealth_passcode'
      | 'rescheduled_from_id'
      | 'patient_response'
      | 'reminder_scheduled'
      | 'reminder_sent'
      | 'reminder_sent_at'
      | 'outlook_event_id'
    >,
  ): Promise<AppointmentDb> {
    const rows = await (trx as Knex)<AppointmentDb>('appointments')
      .insert({ ...row, created_at: new Date(), updated_at: new Date(), deleted_at: null })
      .returning(APPOINTMENT_COLUMNS) as AppointmentDb[];
    return rows[0];
  },

  async update(
    trx: Knex.Transaction | Knex = db,
    clinicId: string,
    id: string,
    patch: Partial<AppointmentDb>,
  ): Promise<AppointmentDb | null> {
    const rows = await (trx as Knex)<AppointmentDb>('appointments')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ ...patch, updated_at: new Date() })
      .returning(APPOINTMENT_COLUMNS) as AppointmentDb[];
    return rows[0] ?? null;
  },

  async findById(clinicId: string, id: string): Promise<AppointmentDb | null> {
    const row = await db<AppointmentDb>('appointments')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  },

  async list(filters: AppointmentListFilters): Promise<AppointmentDb[]> {
    const { clinicId, patientId, clinicianId, specialtyCode, status, from, to, limit, offset } = filters;

    // Phase 13 PR5 — when filtering by clinicianId, pivot through
    // the appointment_attendees junction so multi-clinician
    // appointments appear in every participant's calendar (not just
    // the row whose appointments.clinician_id matches). Without the
    // pivot, a co_clinician would never see a shared booking in
    // their day view. The single-clinician fast path is preserved
    // by always writing a primary attendee row in service.create.
    if (clinicianId) {
      const rows = (await db('appointments as a')
        .join('appointment_attendees as aa', 'aa.appointment_id', 'a.id')
        .where('a.clinic_id', clinicId)
        .whereNull('a.deleted_at')
        .where('aa.staff_id', clinicianId)
        .whereNot('aa.attendance_status', 'removed')
        .modify((q) => {
          if (patientId) q.andWhere('a.patient_id', patientId);
          if (specialtyCode) q.andWhere('a.specialty_code', specialtyCode);
          if (status) q.andWhere('a.status', status);
          if (from) q.andWhere('a.appointment_start', '>=', from);
          if (to) q.andWhere('a.appointment_start', '<=', to);
        })
        .orderBy('a.appointment_start', 'asc')
        .limit(limit)
        .offset(offset)
        .select('a.*')) as AppointmentDb[];
      return rows;
    }

    const query = db<AppointmentDb>('appointments')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('appointment_start', 'asc')
      .limit(limit)
      .offset(offset);

    if (patientId) query.andWhere('patient_id', patientId);
    if (specialtyCode) query.andWhere('specialty_code', specialtyCode);
    if (status) query.andWhere('status', status);
    if (from) query.andWhere('appointment_start', '>=', from);
    if (to) query.andWhere('appointment_start', '<=', to);

    return query;
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db<AppointmentDb>('appointments')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
  },
};
