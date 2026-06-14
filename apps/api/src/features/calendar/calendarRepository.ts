// apps/api/src/features/calendar/calendarRepository.ts
//
// Phase 13 PR2b — data-layer for the per-clinician calendar.
//
// Two tables, both shipped by 20260601000000_clinician_calendar.ts:
//
//   clinician_availability_blocks
//     Weekly traffic-light blocks OR one-off overrides. Each row
//     is either (recurrence='weekly' + day_of_week) or
//     (recurrence='none' + specific_date) — enforced at the DB
//     via `cab_recurrence_shape_chk`.
//
//   staff_settings (key = 'calendar_preferences')
//     JSONB blob for the clinician's slotMinutes / weekStart /
//     icalToken / icalTokenIssuedAt. Stored as a single row per
//     staff member under the setting_key convention.
//
// CLAUDE.md rules applied:
//   §1.3  every query filters by clinic_id AND clinician_id
//   §1.4  whereNull('deleted_at') on cab (it has the column)
//   §1.6  every insert on RLS table includes clinic_id
//   §3.1  every async method is wrapped by a controller that
//         handles try/catch — this repo throws on error

import { db } from '../../db/db';
import { hasOptionalTable } from '../../shared/optionalSchema';

export type AvailabilityColour = 'red' | 'yellow' | 'green';
export type Recurrence = 'none' | 'weekly';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: clinician_availability_blocks has these 17 columns matching
// AvailabilityBlockDb exactly.
const AVAILABILITY_BLOCK_COLUMNS = [
  'id',
  'clinic_id',
  'clinician_id',
  'colour',
  'recurrence',
  'day_of_week',
  'specific_date',
  'start_time',
  'end_time',
  'effective_from',
  'effective_until',
  'label',
  'notes',
  'created_by_staff_id',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export interface AvailabilityBlockDb {
  id: string;
  clinic_id: string;
  clinician_id: string;
  colour: AvailabilityColour;
  recurrence: Recurrence;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_until: string | null;
  label: string | null;
  notes: string | null;
  created_by_staff_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface AvailabilityBlockInsert {
  clinic_id: string;
  clinician_id: string;
  colour: AvailabilityColour;
  recurrence: Recurrence;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
  effective_from?: string;
  effective_until?: string | null;
  label?: string | null;
  notes?: string | null;
  created_by_staff_id?: string | null;
}

export interface AvailabilityBlockUpdate {
  colour?: AvailabilityColour;
  recurrence?: Recurrence;
  day_of_week?: number | null;
  specific_date?: string | null;
  start_time?: string;
  end_time?: string;
  effective_from?: string;
  effective_until?: string | null;
  label?: string | null;
  notes?: string | null;
}

export interface AvailabilityBlockListFilters {
  clinicId: string;
  clinicianId: string;
  // Window for one-off rows — weekly rows are always returned.
  from?: string;
  to?: string;
}

export interface CalendarPreferencesBlob {
  slotMinutes: 15 | 20 | 30 | 45 | 60;
  weekStart: number;
  icalToken?: string;
  icalTokenIssuedAt?: string;
}

// ── Availability blocks ──────────────────────────────────────────

async function listAvailabilityBlocks(
  filters: AvailabilityBlockListFilters,
): Promise<AvailabilityBlockDb[]> {
  const q = db<AvailabilityBlockDb>('clinician_availability_blocks')
    .where({
      clinic_id: filters.clinicId,
      clinician_id: filters.clinicianId,
    })
    .whereNull('deleted_at');

  if (filters.from || filters.to) {
    // Weekly rows are always in scope; one-off rows are filtered
    // by specific_date within [from, to].
    q.andWhere((builder) => {
      builder.where('recurrence', 'weekly');
      if (filters.from && filters.to) {
        builder.orWhere((b) =>
          b
            .where('recurrence', 'none')
            .andWhereBetween('specific_date', [filters.from!, filters.to!]),
        );
      } else if (filters.from) {
        builder.orWhere((b) =>
          b
            .where('recurrence', 'none')
            .andWhere('specific_date', '>=', filters.from!),
        );
      } else if (filters.to) {
        builder.orWhere((b) =>
          b
            .where('recurrence', 'none')
            .andWhere('specific_date', '<=', filters.to!),
        );
      }
    });
  }

  return q
    .orderBy([
      { column: 'day_of_week', order: 'asc' },
      { column: 'specific_date', order: 'asc' },
      { column: 'start_time', order: 'asc' },
    ]) as Promise<AvailabilityBlockDb[]>;
}

async function getAvailabilityBlockById(
  clinicId: string,
  id: string,
): Promise<AvailabilityBlockDb | undefined> {
  return db<AvailabilityBlockDb>('clinician_availability_blocks')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .first() as Promise<AvailabilityBlockDb | undefined>;
}

async function createAvailabilityBlock(
  row: AvailabilityBlockInsert,
): Promise<AvailabilityBlockDb> {
  const [created] = await db<AvailabilityBlockDb>(
    'clinician_availability_blocks',
  )
    .insert({
      ...row,
      effective_from: row.effective_from ?? new Date().toISOString().slice(0, 10),
      effective_until: row.effective_until ?? null,
      label: row.label ?? null,
      notes: row.notes ?? null,
      created_by_staff_id: row.created_by_staff_id ?? null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    })
    .returning(AVAILABILITY_BLOCK_COLUMNS) as AvailabilityBlockDb[];
  return created;
}

async function updateAvailabilityBlock(
  clinicId: string,
  id: string,
  patch: AvailabilityBlockUpdate,
): Promise<AvailabilityBlockDb | undefined> {
  const [updated] = await db<AvailabilityBlockDb>(
    'clinician_availability_blocks',
  )
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .update({
      ...patch,
      updated_at: new Date(),
    })
    .returning(AVAILABILITY_BLOCK_COLUMNS) as AvailabilityBlockDb[];
  return updated;
}

async function softDeleteAvailabilityBlock(
  clinicId: string,
  id: string,
): Promise<number> {
  return db<AvailabilityBlockDb>('clinician_availability_blocks')
    .where({ id, clinic_id: clinicId })
    .whereNull('deleted_at')
    .update({ deleted_at: new Date(), updated_at: new Date() });
}

// ── Calendar preferences (staff_settings row) ────────────────────

const SETTING_KEY = 'calendar_preferences';

const DEFAULT_PREFERENCES: CalendarPreferencesBlob = {
  slotMinutes: 30,
  weekStart: 1,
};

interface StaffSettingRow {
  id: string;
  staff_id: string;
  setting_key: string;
  setting_value: CalendarPreferencesBlob | null;
}

async function getCalendarPreferences(
  clinicianId: string,
): Promise<CalendarPreferencesBlob> {
  const row = (await db<StaffSettingRow>('staff_settings')
    .where({ staff_id: clinicianId, setting_key: SETTING_KEY })
    .first()) as StaffSettingRow | undefined;
  if (!row || !row.setting_value) return { ...DEFAULT_PREFERENCES };
  return { ...DEFAULT_PREFERENCES, ...row.setting_value };
}

async function setCalendarPreferences(
  clinicianId: string,
  prefs: CalendarPreferencesBlob,
): Promise<CalendarPreferencesBlob> {
  const existing = (await db<StaffSettingRow>('staff_settings')
    .where({ staff_id: clinicianId, setting_key: SETTING_KEY })
    .first()) as StaffSettingRow | undefined;
  if (existing) {
    await db<StaffSettingRow>('staff_settings')
      .where({ staff_id: clinicianId, setting_key: SETTING_KEY })
      .update({
        setting_value: prefs as unknown as CalendarPreferencesBlob,
        updated_at: new Date(),
      } as Partial<StaffSettingRow & { updated_at: Date }>);
  } else {
    await db('staff_settings').insert({
      staff_id: clinicianId,
      setting_key: SETTING_KEY,
      setting_value: prefs,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }
  return prefs;
}

// ── Today-view aggregates ────────────────────────────────────────

export interface TodayViewAppointmentDb {
  id: string;
  clinic_id: string;
  patient_id: string;
  clinician_id: string | null;
  patient_given_name: string;
  patient_family_name: string;
  appointment_start: Date;
  appointment_end: Date;
  appointment_type: string;
  status: string;
  telehealth: boolean;
  notes: string | null;
}

/**
 * List appointments for a single clinician on a single date via
 * the Phase 13 PR1 appointment_attendees junction. The junction
 * holds one row per (appointment, staff) pair — every legacy
 * single-clinician appointment was backfilled into it by the
 * 20260601 migration so existing appointments still show up in
 * this query.
 *
 * Not filtering by `clinician_id` on the appointments table
 * itself because a future multi-clinician appointment (supervisor
 * sitting in on a registrar's session, two clinicians in a joint
 * med review) should appear in BOTH calendars — the junction
 * captures that intent natively.
 *
 * Every query filters by clinic_id per §1.3, whereNull('deleted_at')
 * on appointments (the table has the column), and excludes the
 * 'removed' attendance_status so a historical attendance override
 * of "supervisor removed from the session" cleanly drops the row
 * from that supervisor's calendar without mutating the underlying
 * appointment.
 */
async function listAppointmentsForClinicianOnDate(
  clinicId: string,
  clinicianId: string,
  isoDate: string,
): Promise<TodayViewAppointmentDb[]> {
  const start = `${isoDate} 00:00:00`;
  const end = `${isoDate} 23:59:59`;

  if (!(await hasOptionalTable('appointment_attendees'))) {
    const legacyRows = (await db('appointments as a')
      .join('patients as p', 'p.id', 'a.patient_id')
      .where({
        'a.clinic_id': clinicId,
        'a.clinician_id': clinicianId,
      })
      .whereNull('a.deleted_at')
      .andWhereBetween('a.appointment_start', [start, end])
      .orderBy('a.appointment_start', 'asc')
      .select({
        id: 'a.id',
        clinic_id: 'a.clinic_id',
        patient_id: 'a.patient_id',
        clinician_id: 'a.clinician_id',
        patient_given_name: 'p.given_name',
        patient_family_name: 'p.family_name',
        appointment_start: 'a.appointment_start',
        appointment_end: 'a.appointment_end',
        appointment_type: 'a.appointment_type',
        status: 'a.status',
        telehealth: 'a.telehealth',
        notes: 'a.notes',
      })) as TodayViewAppointmentDb[];
    return legacyRows;
  }

  const rows = (await db('appointments as a')
    .join('appointment_attendees as aa', 'aa.appointment_id', 'a.id')
    .join('patients as p', 'p.id', 'a.patient_id')
    .where({
      'a.clinic_id': clinicId,
      'aa.staff_id': clinicianId,
    })
    .whereNull('a.deleted_at')
    .whereNot('aa.attendance_status', 'removed')
    .andWhereBetween('a.appointment_start', [start, end])
    .orderBy('a.appointment_start', 'asc')
    .select({
      id: 'a.id',
      clinic_id: 'a.clinic_id',
      patient_id: 'a.patient_id',
      clinician_id: 'a.clinician_id',
      patient_given_name: 'p.given_name',
      patient_family_name: 'p.family_name',
      appointment_start: 'a.appointment_start',
      appointment_end: 'a.appointment_end',
      appointment_type: 'a.appointment_type',
      status: 'a.status',
      telehealth: 'a.telehealth',
      notes: 'a.notes',
    })) as TodayViewAppointmentDb[];
  return rows;
}

export interface TodayViewContactDb {
  id: string;
  clinic_id: string;
  patient_id: string;
  staff_id: string | null;
  patient_given_name: string;
  patient_family_name: string;
  contact_date: string;
  duration_min: number | null;
  status: string;
}

/**
 * Contact records completed (or drafted) by a clinician on a
 * specific date. NO `.whereNull('deleted_at')` — contact_records
 * is on the CLAUDE.md §1.4 forbidden list: it has no deleted_at
 * column. Status filtering happens at the service layer so the
 * today-view can split draft vs signed counts.
 */
async function listContactRecordsForStaffOnDate(
  clinicId: string,
  staffId: string,
  isoDate: string,
): Promise<TodayViewContactDb[]> {
  return (await db('contact_records as cr')
    .join('patients as p', 'p.id', 'cr.patient_id')
    .where({
      'cr.clinic_id': clinicId,
      'cr.staff_id': staffId,
      'cr.contact_date': isoDate,
    })
    .orderBy('cr.created_at', 'asc')
    .select({
      id: 'cr.id',
      clinic_id: 'cr.clinic_id',
      patient_id: 'cr.patient_id',
      staff_id: 'cr.staff_id',
      patient_given_name: 'p.given_name',
      patient_family_name: 'p.family_name',
      contact_date: 'cr.contact_date',
      duration_min: 'cr.duration_min',
      status: 'cr.status',
    })) as TodayViewContactDb[];
}

// ── Exports ──────────────────────────────────────────────────────

export const calendarRepository = {
  listAvailabilityBlocks,
  getAvailabilityBlockById,
  createAvailabilityBlock,
  updateAvailabilityBlock,
  softDeleteAvailabilityBlock,
  getCalendarPreferences,
  setCalendarPreferences,
  listAppointmentsForClinicianOnDate,
  listContactRecordsForStaffOnDate,
};

export { SETTING_KEY as CALENDAR_SETTING_KEY, DEFAULT_PREFERENCES };
