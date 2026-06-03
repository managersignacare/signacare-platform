// apps/api/src/features/appointments/waitlistRepository.ts
import { db } from '../../db/db';
import type { Knex } from 'knex';

export type WaitlistPriority = 'low' | 'medium' | 'high' | 'urgent';
export type WaitlistStatus = 'waiting' | 'offered' | 'converted' | 'expired' | 'withdrawn';

// Mirrors the `waitlist_entries` table. Phase 0.7.5 c24 C4 (SD12) fixed
// three column renames — previously the interface declared assigned_to_id,
// date_added, target_date which don't exist. Verified via psql \d on
// 2026-04-17. Added the previously-missing preferred_time_of_day /
// preferred_start_time / preferred_end_time fields so the UI can expose
// them (response-shape change is additive — frontend continues to read
// addedDate/targetAppointmentBy via the service mapping layer).
export interface WaitlistEntryDb {
  id: string;
  clinic_id: string;
  patient_id: string;
  referral_id: string | null;
  preferred_clinician_id: string | null;
  priority: WaitlistPriority;
  preferred_time_of_day: string | null;
  preferred_start_time: string | null;
  preferred_end_time: string | null;
  added_date: string;
  target_appointment_by: string | null;
  status: WaitlistStatus;
  converted_appointment_id: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface WaitlistListFilters {
  clinicId: string;
  patientId?: string;
  status?: WaitlistStatus;
  priority?: WaitlistPriority;
  limit: number;
  offset: number;
}

// Phase 0.7.5 c24 D1 — explicit column list matches the WaitlistEntryDb
// interface (which was aligned to the DB in c24 C4). Knex types
// .returning(arr) as Partial<T>[] so the cast to WaitlistEntryDb[] is
// needed to preserve the declared return type.
const WAITLIST_ENTRY_COLUMNS = [
  'id',
  'clinic_id',
  'patient_id',
  'referral_id',
  'preferred_clinician_id',
  'priority',
  'preferred_time_of_day',
  'preferred_start_time',
  'preferred_end_time',
  'added_date',
  'target_appointment_by',
  'status',
  'converted_appointment_id',
  'notes',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export const waitlistRepository = {
  async create(
    trx: Knex.Transaction | Knex = db,
    row: Omit<WaitlistEntryDb, 'id' | 'created_at' | 'updated_at' | 'deleted_at'>,
  ): Promise<WaitlistEntryDb> {
    const rows = await (trx as Knex)<WaitlistEntryDb>('waitlist_entries')
      .insert({ ...row, created_at: new Date(), updated_at: new Date(), deleted_at: null })
      .returning(WAITLIST_ENTRY_COLUMNS) as WaitlistEntryDb[];
    return rows[0];
  },

  async update(
    trx: Knex.Transaction | Knex = db,
    clinicId: string,
    id: string,
    patch: Partial<WaitlistEntryDb>,
  ): Promise<WaitlistEntryDb | null> {
    const rows = await (trx as Knex)<WaitlistEntryDb>('waitlist_entries')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ ...patch, updated_at: new Date() })
      .returning(WAITLIST_ENTRY_COLUMNS) as WaitlistEntryDb[];
    return rows[0] ?? null;
  },

  async findById(clinicId: string, id: string): Promise<WaitlistEntryDb | null> {
    const row = await db<WaitlistEntryDb>('waitlist_entries')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first();
    return row ?? null;
  },

  async list(filters: WaitlistListFilters): Promise<WaitlistEntryDb[]> {
    const { clinicId, patientId, status, priority, limit, offset } = filters;
    const query = db<WaitlistEntryDb>('waitlist_entries')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('added_date', 'asc')
      .limit(limit)
      .offset(offset);

    if (patientId) query.andWhere('patient_id', patientId);
    if (status) query.andWhere('status', status);
    if (priority) query.andWhere('priority', priority);

    return query;
  },

  async softDelete(clinicId: string, id: string): Promise<void> {
    await db<WaitlistEntryDb>('waitlist_entries')
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date(), updated_at: new Date() });
  },
};