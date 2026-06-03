// apps/api/src/features/appointments/appointmentAttendeeRepository.ts
//
// Phase 13 PR5 — primitive Knex layer for the appointment_attendees
// junction. The schema lives at migration 20260601000000 (Phase 13A).
//
// Every method takes a Knex.Transaction or default db so callers can
// compose attendee writes inside the appointment create/update
// transaction (CLAUDE.md §2.1).

import { db } from '../../db/db';
import type { Knex } from 'knex';

export type AppointmentAttendeeRole =
  | 'primary'
  | 'co_clinician'
  | 'supervisor'
  | 'observer'
  | 'interpreter'
  | 'support';

export type AppointmentAttendanceStatus =
  | 'required'
  | 'accepted'
  | 'tentative'
  | 'declined'
  | 'attended'
  | 'did_not_attend'
  | 'removed';

export interface AppointmentAttendeeDb {
  id: string;
  appointment_id: string;
  clinic_id: string;
  staff_id: string;
  role: AppointmentAttendeeRole;
  attendance_status: AppointmentAttendanceStatus;
  invited_at: Date;
  responded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AppointmentAttendeeWithName extends AppointmentAttendeeDb {
  staff_given_name: string | null;
  staff_family_name: string | null;
}

export interface AttendeeOverlap {
  staff_id: string;
  appointment_id: string;
  appointment_start: Date;
  appointment_end: Date;
}

export const appointmentAttendeeRepository = {
  async listForAppointment(
    clinicId: string,
    appointmentId: string,
    trx?: Knex.Transaction,
  ): Promise<AppointmentAttendeeWithName[]> {
    // PR-R1-5 cycle-2: optional `trx` lets transactional callers reuse
    // the transaction's connection (CLAUDE.md §2.1). When omitted, falls
    // back to the pool's default `db`.
    const q = trx ?? db;
    const rows = (await q('appointment_attendees as aa')
      .leftJoin('staff as s', 's.id', 'aa.staff_id')
      .where({ 'aa.clinic_id': clinicId, 'aa.appointment_id': appointmentId })
      .orderBy('aa.invited_at', 'asc')
      .select(
        'aa.id',
        'aa.appointment_id',
        'aa.clinic_id',
        'aa.staff_id',
        'aa.role',
        'aa.attendance_status',
        'aa.invited_at',
        'aa.responded_at',
        'aa.created_at',
        'aa.updated_at',
        's.given_name as staff_given_name',
        's.family_name as staff_family_name',
      )) as AppointmentAttendeeWithName[];
    return rows;
  },

  async insertMany(
    trx: Knex.Transaction | Knex,
    rows: Array<Omit<AppointmentAttendeeDb, 'id' | 'created_at' | 'updated_at' | 'invited_at' | 'responded_at'>>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    const payload = rows.map((r) => ({
      ...r,
      invited_at: now,
      responded_at: null,
      created_at: now,
      updated_at: now,
    }));
    await (trx as Knex)('appointment_attendees')
      .insert(payload)
      .onConflict(['appointment_id', 'staff_id'])
      .ignore();
  },

  async addAttendee(
    trx: Knex.Transaction | Knex,
    row: {
      clinic_id: string;
      appointment_id: string;
      staff_id: string;
      role: AppointmentAttendeeRole;
    },
  ): Promise<void> {
    const now = new Date();
    await (trx as Knex)('appointment_attendees')
      .insert({
        clinic_id: row.clinic_id,
        appointment_id: row.appointment_id,
        staff_id: row.staff_id,
        role: row.role,
        attendance_status: 'required',
        invited_at: now,
        responded_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['appointment_id', 'staff_id'])
      .merge({
        role: row.role,
        attendance_status: 'required',
        updated_at: now,
      });
  },

  async updateAttendee(
    trx: Knex.Transaction | Knex,
    clinicId: string,
    appointmentId: string,
    staffId: string,
    patch: Partial<Pick<AppointmentAttendeeDb, 'role' | 'attendance_status'>>,
  ): Promise<number> {
    const updated = await (trx as Knex)('appointment_attendees')
      .where({
        clinic_id: clinicId,
        appointment_id: appointmentId,
        staff_id: staffId,
      })
      .update({ ...patch, updated_at: new Date() });
    return updated;
  },

  async markRemoved(
    trx: Knex.Transaction | Knex,
    clinicId: string,
    appointmentId: string,
    staffIds: string[],
  ): Promise<void> {
    if (staffIds.length === 0) return;
    await (trx as Knex)('appointment_attendees')
      .where({ clinic_id: clinicId, appointment_id: appointmentId })
      .whereIn('staff_id', staffIds)
      .whereNot('role', 'primary')
      .update({ attendance_status: 'removed', updated_at: new Date() });
  },

  /**
   * Replace the primary attendee row when the appointment's
   * clinician_id changes. If the new primary was already an
   * attendee (e.g. as a co_clinician), promotes that row to
   * primary and demotes-then-removes the old row. Atomic via the
   * transaction the caller passes.
   */
  async replacePrimary(
    trx: Knex.Transaction | Knex,
    clinicId: string,
    appointmentId: string,
    newPrimaryStaffId: string,
  ): Promise<void> {
    const now = new Date();
    // 1. Demote any existing primary row to removed (preserving history).
    await (trx as Knex)('appointment_attendees')
      .where({
        clinic_id: clinicId,
        appointment_id: appointmentId,
        role: 'primary',
      })
      .whereNot('staff_id', newPrimaryStaffId)
      .update({ attendance_status: 'removed', role: 'co_clinician', updated_at: now });

    // 2. Upsert the new primary. Promotes a co_clinician already
    //    present, or inserts a fresh row when the new primary is
    //    a brand-new attendee.
    await (trx as Knex)('appointment_attendees')
      .insert({
        clinic_id: clinicId,
        appointment_id: appointmentId,
        staff_id: newPrimaryStaffId,
        role: 'primary',
        attendance_status: 'required',
        invited_at: now,
        responded_at: null,
        created_at: now,
        updated_at: now,
      })
      .onConflict(['appointment_id', 'staff_id'])
      .merge({
        role: 'primary',
        attendance_status: 'required',
        updated_at: now,
      });
  },

  /**
   * Find conflicting appointments for any of the given staff ids
   * within (start, end). Used by appointmentService to surface
   * per-attendee conflicts when creating or updating a
   * multi-clinician appointment. Optional excludeAppointmentId
   * lets `update` skip the row being patched.
   */
  async findOverlapsForStaff(
    clinicId: string,
    staffIds: string[],
    range: { start: Date; end: Date },
    excludeAppointmentId?: string,
  ): Promise<AttendeeOverlap[]> {
    if (staffIds.length === 0) return [];
    const q = db('appointment_attendees as aa')
      .join('appointments as a', 'a.id', 'aa.appointment_id')
      .where('a.clinic_id', clinicId)
      .whereNull('a.deleted_at')
      .whereNot('a.status', 'cancelled')
      .whereNot('aa.attendance_status', 'removed')
      .whereIn('aa.staff_id', staffIds)
      .andWhere((b) => {
        b.whereBetween('a.appointment_start', [range.start, range.end])
          .orWhereBetween('a.appointment_end', [range.start, range.end])
          .orWhere((bb) =>
            bb
              .where('a.appointment_start', '<', range.start)
              .andWhere('a.appointment_end', '>', range.end),
          );
      })
      .select(
        'aa.staff_id',
        'a.id as appointment_id',
        'a.appointment_start',
        'a.appointment_end',
      );
    if (excludeAppointmentId) q.whereNot('a.id', excludeAppointmentId);
    return (await q) as AttendeeOverlap[];
  },
};
