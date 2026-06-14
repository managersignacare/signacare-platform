// apps/api/src/features/calendar/calendarService.ts
//
// Phase 13 PR2b — business logic for the per-clinician calendar.
//
// The service layer is thin above the repository — most work is
// validation, mapping DB rows to the shared Zod response shape
// (§5.2), and the tiny bit of iCal token rotation book-keeping
// that the preferences writer needs.

import { AppError } from '../../shared/errors';
import type { AvailabilityBlock, CalendarPreferences } from '@signacare/shared';
import {
  calendarRepository,
  type AvailabilityBlockDb,
  type CalendarPreferencesBlob,
  type AvailabilityBlockInsert,
  type AvailabilityBlockUpdate,
  type AvailabilityBlockListFilters,
  DEFAULT_PREFERENCES,
} from './calendarRepository';
import { mintToken } from './icalTokenService';
import { config } from '../../config/config';
import { randomBytes } from 'crypto';

// ── Response mapping (§5.1 + §5.2) ───────────────────────────────

export function mapBlockDbToResponse(
  row: AvailabilityBlockDb,
): AvailabilityBlock {
  return {
    id: row.id,
    clinicianId: row.clinician_id,
    colour: row.colour,
    recurrence: row.recurrence,
    dayOfWeek: row.day_of_week,
    specificDate: row.specific_date,
    startTime: row.start_time,
    endTime: row.end_time,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    label: row.label,
    notes: row.notes,
  };
}

function mapPreferencesBlobToResponse(
  blob: CalendarPreferencesBlob,
): CalendarPreferences {
  return {
    slotMinutes: blob.slotMinutes,
    weekStart: blob.weekStart,
    icalToken: blob.icalToken,
    icalTokenIssuedAt: blob.icalTokenIssuedAt,
  };
}

// ── Availability blocks ──────────────────────────────────────────

async function listAvailabilityBlocks(
  filters: AvailabilityBlockListFilters,
): Promise<AvailabilityBlock[]> {
  const rows = await calendarRepository.listAvailabilityBlocks(filters);
  return rows.map(mapBlockDbToResponse);
}

async function createAvailabilityBlock(
  row: AvailabilityBlockInsert,
): Promise<AvailabilityBlock> {
  validateBlockShape(row);
  const created = await calendarRepository.createAvailabilityBlock(row);
  return mapBlockDbToResponse(created);
}

async function updateAvailabilityBlock(
  clinicId: string,
  id: string,
  patch: AvailabilityBlockUpdate,
): Promise<AvailabilityBlock> {
  // Fetch existing so we can merge + validate the post-patch shape.
  const existing = await calendarRepository.getAvailabilityBlockById(
    clinicId,
    id,
  );
  if (!existing) {
    throw new AppError(
      `Availability block ${id} not found`,
      404,
      'NOT_FOUND',
    );
  }
  const merged = {
    ...existing,
    ...patch,
  };
  validateBlockShape({
    colour: merged.colour,
    recurrence: merged.recurrence,
    day_of_week: merged.day_of_week,
    specific_date: merged.specific_date,
    start_time: merged.start_time,
    end_time: merged.end_time,
  });
  const updated = await calendarRepository.updateAvailabilityBlock(
    clinicId,
    id,
    patch,
  );
  if (!updated) {
    throw new AppError(
      `Availability block ${id} not found`,
      404,
      'NOT_FOUND',
    );
  }
  return mapBlockDbToResponse(updated);
}

async function softDeleteAvailabilityBlock(
  clinicId: string,
  id: string,
): Promise<void> {
  const count = await calendarRepository.softDeleteAvailabilityBlock(
    clinicId,
    id,
  );
  if (count === 0) {
    throw new AppError(
      `Availability block ${id} not found`,
      404,
      'NOT_FOUND',
    );
  }
}

/**
 * Enforces the same invariants the DB CHECK constraints enforce,
 * one layer up so the client gets a clean 400 rather than a
 * Postgres check_violation error. The DB is still the ultimate
 * source of truth — this is defence-in-depth, not a replacement.
 */
function validateBlockShape(input: {
  colour: string;
  recurrence: string;
  day_of_week: number | null;
  specific_date: string | null;
  start_time: string;
  end_time: string;
}): void {
  if (!['red', 'yellow', 'green'].includes(input.colour)) {
    throw new AppError(
      `Invalid colour: ${input.colour}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  if (!['none', 'weekly', 'fortnightly'].includes(input.recurrence)) {
    throw new AppError(
      `Invalid recurrence: ${input.recurrence}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  if (input.recurrence === 'weekly' || input.recurrence === 'fortnightly') {
    if (input.day_of_week === null || input.day_of_week < 0 || input.day_of_week > 6) {
      throw new AppError(
        "recurrence='weekly'/'fortnightly' requires dayOfWeek in [0,6]",
        400,
        'VALIDATION_ERROR',
      );
    }
    if (input.specific_date !== null) {
      throw new AppError(
        "recurrence='weekly'/'fortnightly' must have null specificDate",
        400,
        'VALIDATION_ERROR',
      );
    }
  } else {
    if (!input.specific_date) {
      throw new AppError(
        "recurrence='none' requires specificDate",
        400,
        'VALIDATION_ERROR',
      );
    }
    if (input.day_of_week !== null) {
      throw new AppError(
        "recurrence='none' must have null dayOfWeek",
        400,
        'VALIDATION_ERROR',
      );
    }
  }
  if (input.end_time <= input.start_time) {
    throw new AppError(
      'endTime must be later than startTime',
      400,
      'VALIDATION_ERROR',
    );
  }
}

// ── Preferences ──────────────────────────────────────────────────

async function getCalendarPreferences(
  clinicianId: string,
): Promise<CalendarPreferences> {
  const blob = await calendarRepository.getCalendarPreferences(clinicianId);
  return mapPreferencesBlobToResponse(blob);
}

async function updateCalendarPreferences(
  clinicianId: string,
  patch: Partial<CalendarPreferences>,
): Promise<CalendarPreferences> {
  // Merge with existing + defaults so partial updates don't wipe
  // the slotMinutes / weekStart fields.
  const existing = await calendarRepository.getCalendarPreferences(clinicianId);
  const merged: CalendarPreferencesBlob = {
    ...DEFAULT_PREFERENCES,
    ...existing,
    ...patch,
    // Belt-and-braces: coerce slotMinutes to one of the allowed
    // 15/20/30/45/60 union values.
    slotMinutes: (patch.slotMinutes ?? existing.slotMinutes) as
      | 15
      | 20
      | 30
      | 45
      | 60,
  };
  const saved = await calendarRepository.setCalendarPreferences(
    clinicianId,
    merged,
  );
  return mapPreferencesBlobToResponse(saved);
}

// ── iCal token rotation ──────────────────────────────────────────

/**
 * Rotate the clinician's iCal subscription token. Generates a new
 * issuedAt timestamp, writes it into staff_settings, and returns
 * the fresh token so the caller can render the subscription URL.
 * Every previously-issued token with an older issuedAt is now
 * rejected by icalTokenService.verifyToken (see the rotation
 * invariant unit tests for the guarantee).
 */
async function rotateIcalToken(
  clinicId: string,
  clinicianId: string,
): Promise<{ token: string; issuedAt: string; url: string }> {
  const issuedAt = new Date().toISOString();
  const token = mintToken(
    { clinicId, clinicianId, issuedAt },
    config.calendar.icalSecret,
  );
  // Persist the issuedAt so verifyToken can reject older tokens.
  const existing = await calendarRepository.getCalendarPreferences(clinicianId);
  await calendarRepository.setCalendarPreferences(clinicianId, {
    ...DEFAULT_PREFERENCES,
    ...existing,
    icalToken: token,
    icalTokenIssuedAt: issuedAt,
  });
  const url = `${config.apiBaseUrl}/api/v1/calendar/ical/${clinicianId}.ics?token=${encodeURIComponent(token)}`;
  return { token, issuedAt, url };
}

/**
 * Resolve the current (token, issuedAt) pair for a clinician. If
 * neither has been minted yet, mint one on the fly so subscribers
 * can start using the URL immediately. This mirrors the
 * "lazy-mint on first read" behaviour documented in the plan.
 */
async function getOrMintIcalToken(
  clinicId: string,
  clinicianId: string,
): Promise<{ token: string; issuedAt: string; url: string }> {
  const existing = await calendarRepository.getCalendarPreferences(clinicianId);
  if (existing.icalToken && existing.icalTokenIssuedAt) {
    const url = `${config.apiBaseUrl}/api/v1/calendar/ical/${clinicianId}.ics?token=${encodeURIComponent(existing.icalToken)}`;
    return {
      token: existing.icalToken,
      issuedAt: existing.icalTokenIssuedAt,
      url,
    };
  }
  return rotateIcalToken(clinicId, clinicianId);
}

// randomBytes is reserved for a future "cryptographically random
// suffix on mint" feature (e.g. to prevent the issuedAt from
// being guessable). Unused today but imported to keep the surface
// ready — mark it void so tsc stays clean.
void randomBytes;

// ── Today view ───────────────────────────────────────────────────

import type {
  TodayViewResponse,
  TodayViewAppointment,
  TodayViewCounts,
  ContactRecordSummary,
} from '@signacare/shared';
import { dbAdmin } from '../../db/db';

const ZERO_COUNTS: TodayViewCounts = {
  scheduled: 0,
  confirmed: 0,
  arrived: 0,
  inSession: 0,
  completed: 0,
  cancelled: 0,
  noShow: 0,
  contactsDraft: 0,
  contactsSigned: 0,
};

function mapAppointmentRow(
  row: import('./calendarRepository').TodayViewAppointmentDb,
): TodayViewAppointment {
  const patientName =
    `${row.patient_given_name ?? ''} ${row.patient_family_name ?? ''}`.trim();
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName,
    clinicianId: row.clinician_id,
    appointmentStart: new Date(row.appointment_start).toISOString(),
    appointmentEnd: new Date(row.appointment_end).toISOString(),
    appointmentType: row.appointment_type,
    status: row.status,
    telehealth: row.telehealth,
    notes: row.notes,
  };
}

function mapContactRow(
  row: import('./calendarRepository').TodayViewContactDb,
): ContactRecordSummary {
  const patientName =
    `${row.patient_given_name ?? ''} ${row.patient_family_name ?? ''}`.trim();
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName,
    contactDate: row.contact_date,
    durationMinutes: row.duration_min ?? 0,
    status: row.status,
  };
}

async function getTodayView(
  clinicId: string,
  clinicianId: string,
  isoDate: string,
): Promise<TodayViewResponse> {
  // BUG-722: keep DB reads sequential under request-scoped RLS transaction
  // to avoid pg concurrent-query deprecation (pg@9 hard-fail path).
  const blocks = await calendarRepository.listAvailabilityBlocks({
    clinicId,
    clinicianId,
    from: isoDate,
    to: isoDate,
  });
  const rawAppointments = await calendarRepository.listAppointmentsForClinicianOnDate(
    clinicId,
    clinicianId,
    isoDate,
  );
  const rawContacts = await calendarRepository.listContactRecordsForStaffOnDate(
    clinicId,
    clinicianId,
    isoDate,
  );
  // Clinician name comes from the staff row. Uses dbAdmin so
  // the lookup works regardless of RLS context; the caller has
  // already been authenticated + tenant-scoped by middleware.
  const clinician = await (dbAdmin('staff')
    .where({ id: clinicianId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .select({ given_name: 'given_name', family_name: 'family_name' })
    .first() as Promise<
    { given_name: string; family_name: string } | undefined
  >);

  const appointments = rawAppointments.map(mapAppointmentRow);
  const allStatuses = appointments.map((a) => a.status);

  // Split DNAs out of the main appointment list so the UI can
  // render two columns cleanly. Every DNA also stays in
  // `allStatuses` so the no_show counter is accurate.
  const dnas = appointments.filter((a) => a.status === 'no_show');
  const nonDnas = appointments.filter((a) => a.status !== 'no_show');

  const counts: TodayViewCounts = {
    ...ZERO_COUNTS,
    scheduled: allStatuses.filter((s) => s === 'scheduled').length,
    confirmed: allStatuses.filter((s) => s === 'confirmed').length,
    arrived: allStatuses.filter((s) => s === 'arrived').length,
    inSession: allStatuses.filter((s) => s === 'in_session').length,
    completed: allStatuses.filter((s) => s === 'completed').length,
    cancelled: allStatuses.filter((s) => s === 'cancelled').length,
    noShow: allStatuses.filter((s) => s === 'no_show').length,
    contactsDraft: rawContacts.filter((c) => c.status === 'draft').length,
    contactsSigned: rawContacts.filter((c) => c.status === 'signed').length,
  };

  const clinicianName = clinician
    ? `${clinician.given_name} ${clinician.family_name}`.trim()
    : '';

  return {
    date: isoDate,
    clinicianId,
    clinicianName,
    availabilityBlocks: blocks.map(mapBlockDbToResponse),
    appointments: nonDnas,
    dnas,
    contacts: rawContacts.map(mapContactRow),
    counts,
  };
}

// ── Exports ──────────────────────────────────────────────────────

export const calendarService = {
  listAvailabilityBlocks,
  createAvailabilityBlock,
  updateAvailabilityBlock,
  softDeleteAvailabilityBlock,
  getCalendarPreferences,
  updateCalendarPreferences,
  rotateIcalToken,
  getOrMintIcalToken,
  getTodayView,
};
