// apps/api/src/features/appointments/appointmentService.ts
//
// Audit Tier 3.5 (HIGH-D5) — service-layer AuthContext migration per
// CLAUDE.md §13. Clinician-facing methods accept AuthContext and
// enforce requirePatientRelationship on create / update / cancel /
// read / status-change paths.
//
// `createInternal` is the cross-service helper used by referral
// strategies (solo/team). Those services authorise access to the
// patient themselves before invoking the booking. Keep that path
// off the AuthContext signature so referral flows don't need a
// simulated AuthContext for a cross-service operation.
// uuidv4 removed — DB uses gen_random_uuid()
import { db } from '../../db/db';
import type { AuthContext } from '@signacare/shared';
import { appointmentRepository, type AppointmentStatus } from './appointmentRepository';
import { appointmentAttendeeRepository } from './appointmentAttendeeRepository';
import { AppError } from '../../shared/errors';
import { logger } from '../../utils/logger';
import { requirePatientReadAccess, requirePatientRelationship } from '../../shared/authGuards';
import {
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
  AppointmentSearchDTO,
  AppointmentResponse,
} from '@signacare/shared';
import { z } from 'zod';
import {
  assertBookingGuardrails,
  clearQueuedAppointmentReminders,
  enqueueAppointmentCalendarSync,
  emitAppointmentBookedNotification,
} from './appointmentLifecycleSupport';
import {
  enrichAppointmentRows,
  mapDbToResponse,
  toResponseListSafe,
} from './appointmentResponseMapper';

type CreateAppointmentDTOType = z.infer<typeof CreateAppointmentDTO>;
type UpdateAppointmentDTOType = z.infer<typeof UpdateAppointmentDTO>;
type AppointmentSearchDTOType = z.infer<typeof AppointmentSearchDTO>;
type AppointmentResponseType = z.infer<typeof AppointmentResponse>;

const allowedStatusTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled:  ['confirmed', 'cancelled', 'no_show', 'rescheduled', 'arrived'],
  confirmed:  ['arrived', 'cancelled', 'no_show', 'rescheduled'],
  arrived:    ['in_session', 'cancelled', 'no_show'],
  in_session: ['completed', 'cancelled'],
  completed:  [],
  cancelled:  [],
  no_show:    [],
  rescheduled: ['scheduled', 'confirmed'],
};

export const appointmentService = {
  /**
   * AuthContext-gated create. Used by every HTTP caller.
   * Any in-clinic appointment writer may book for an in-clinic patient.
   * Operational staff such as reception must be able to place bookings
   * without first establishing a clinical relationship.
   */
  async create(
    auth: AuthContext,
    dto: CreateAppointmentDTOType,
  ): Promise<AppointmentResponseType> {
    return appointmentService.createInternal(auth.clinicId, auth.staffId, dto);
  },

  /**
   * Internal create — used by cross-service referral strategies
   * (solo/team) after they have performed their own authorization.
   * NEVER call this from a route handler; call the AuthContext-based
   * `create` above instead.
   */
  async createInternal(
    clinicId: string,
    staffId: string,
    dto: CreateAppointmentDTOType,
  ): Promise<AppointmentResponseType> {
    const patient = await db('patients')
      .where({ id: dto.patientId, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first('id');
    if (!patient) {
      throw new AppError('Patient not found', 404, 'PATIENT_NOT_FOUND');
    }

    const start = new Date(dto.startTime);
    const end = new Date(dto.endTime);
    if (end <= start) {
      throw new AppError('End time must be after start time', 422, 'INVALID_TIME_RANGE');
    }
    await assertBookingGuardrails(clinicId, start, end);

    const primaryClinicianId = dto.clinicianId ?? staffId;
    const appointmentMode =
      dto.mode
      ?? (dto.telehealthDetails?.telehealthLink ? 'videoconference' : undefined)
      ?? (dto.type === 'telehealth' ? 'telehealth' : 'direct');
    const remoteMode =
      appointmentMode === 'telehealth' || appointmentMode === 'videoconference';

    // Phase 13 PR5 — multi-attendee overlap. Every participating
    // clinician (primary + co_clinicians) must be free in the
    // selected window. The repository runs ONE query against the
    // junction so a 5-attendee booking is still one round-trip.
    const allAttendeeIds = Array.from(
      new Set([primaryClinicianId, ...(dto.attendeeStaffIds ?? [])]),
    );
    const overlaps = await appointmentAttendeeRepository.findOverlapsForStaff(
      clinicId,
      allAttendeeIds,
      { start, end },
    );
    if (overlaps.length > 0) {
      throw new AppError(
        'One or more clinicians are already booked during this time slot',
        409,
        'APPOINTMENT_CONFLICT',
      );
    }

    // Multi-specialty: resolve the specialty this appointment belongs to.
    // Same priority chain as the prescriber resolver — explicit override,
    // then linked episode, then clinician's primary, then mental_health.
    const { resolvePrescriberSpecialty } = await import('../medications/prescriberSpecialtyResolver');
    const specialtyCode = await resolvePrescriberSpecialty({
      clinicId,
      actorStaffId: primaryClinicianId,
      episodeId: dto.episodeId ?? null,
      explicitCode: dto.specialtyCode ?? null,
    });

    const rowToInsert = {
      clinic_id: clinicId,
      patient_id: dto.patientId,
      clinician_id: primaryClinicianId,
      staff_id: primaryClinicianId,
      episode_id: dto.episodeId ?? null,
      specialty_code: specialtyCode,
      start_time: start,
      end_time: end,
      appointment_start: start,
      appointment_end: end,
      status: 'scheduled' as AppointmentStatus,
      type: dto.type ?? 'follow_up',
      appointment_type: dto.type ?? 'follow_up',
      mode: appointmentMode,
      notes: dto.notes ?? null,
      telehealth: remoteMode,
      telehealth_url: dto.telehealthDetails?.telehealthLink ?? null,
      cancellation_reason: null,
      cancelled_by_id: null,
    };

    // Phase 13 PR5 — wrap appointment + attendee writes in a single
    // transaction so a failed attendee insert rolls back the whole
    // booking (CLAUDE.md §2.1).
    const created = await db.transaction(async (trx) => {
      const apt = await appointmentRepository.create(trx, rowToInsert);

      // Always write the primary attendee row so the calendar JOIN
      // surfaces this appointment in the clinician's day view.
      // Existing single-clinician appointments depend on this row.
      await appointmentAttendeeRepository.insertMany(trx, [
        {
          clinic_id: clinicId,
          appointment_id: apt.id,
          staff_id: primaryClinicianId,
          role: 'primary',
          attendance_status: 'required',
        },
      ]);

      // Co-clinician attendees (if any). De-duped against the primary.
      const coIds = (dto.attendeeStaffIds ?? []).filter(
        (id) => id !== primaryClinicianId,
      );
      if (coIds.length > 0) {
        await appointmentAttendeeRepository.insertMany(
          trx,
          coIds.map((id) => ({
            clinic_id: clinicId,
            appointment_id: apt.id,
            staff_id: id,
            role: 'co_clinician',
            attendance_status: 'required',
          })),
        );
      }

      return apt;
    });

    await emitAppointmentBookedNotification({
      clinicId,
      appointmentId: String(created['id']),
      createdByStaffId: staffId,
      clinicianId: primaryClinicianId,
      patientId: dto.patientId,
      startTimeIso: start.toISOString(),
    });
    const extraAttendees = (dto.attendeeStaffIds ?? []).filter(
      (id) => id !== primaryClinicianId,
    );
    await Promise.all(
      extraAttendees.map((attendeeId) =>
        emitAppointmentBookedNotification({
          clinicId,
          appointmentId: String(created['id']),
          createdByStaffId: staffId,
          clinicianId: attendeeId,
          patientId: dto.patientId,
          startTimeIso: start.toISOString(),
        }),
      ),
    );
    await enqueueAppointmentCalendarSync({
      clinicId,
      appointmentId: String(created['id']),
      clinicianId: primaryClinicianId,
      patientId: dto.patientId,
      appointmentType: dto.type ?? 'follow_up',
      mode: appointmentMode,
      startTimeIso: start.toISOString(),
      endTimeIso: end.toISOString(),
      notes: dto.notes ?? null,
      attendeeStaffIds: dto.attendeeStaffIds ?? [],
      type: 'create',
    });

    const [enriched] = await enrichAppointmentRows(clinicId, [
      created as unknown as Record<string, unknown>,
    ]);
    return mapDbToResponse(enriched);
  },

  async createRecurring(
    auth: AuthContext,
    dto: CreateAppointmentDTOType & {
      recurrenceRule?: string;
      recurrenceEndDate?: string;
      recurrenceDays?: number[];   // 0=Sun, 1=Mon, ..., 6=Sat
      recurrenceTime?: string;     // HH:mm
    },
  ): Promise<AppointmentResponseType[]> {
    const { clinicId, staffId } = auth;
    const rule = dto.recurrenceRule ?? 'weekly';
    const endDate = dto.recurrenceEndDate ? new Date(dto.recurrenceEndDate) : (() => { const d = new Date(dto.startTime); d.setMonth(d.getMonth() + 3); return d; })();
    const selectedDays = dto.recurrenceDays ?? [];
    const recurrenceTime = dto.recurrenceTime; // e.g. "14:00"

    const results: AppointmentResponseType[] = [];
    const startBase = new Date(dto.startTime);
    const endBase = new Date(dto.endTime);
    const durationMs = endBase.getTime() - startBase.getTime();

    // Create parent appointment (uses Internal — relationship already
    // verified above for this patient).
    const parent = await this.createInternal(clinicId, staffId, dto);
    await db('appointments').where({ id: parent.id }).update({ recurrence_rule: rule, recurrence_end_date: endDate });
    results.push(parent);

    // Generate recurring instances
    if ((rule === 'weekly' || rule === 'fortnightly') && selectedDays.length > 0) {
      // Day-of-week based: generate appointments on each selected day
      const weekStep = rule === 'fortnightly' ? 2 : 1;
      const weekStart = new Date(startBase);
      // Move to start of the week (Sunday)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      // Start from the next week
      weekStart.setDate(weekStart.getDate() + 7 * weekStep);

      for (let w = 0; w < 52; w++) {
        for (const dayOfWeek of selectedDays) {
          const instanceDate = new Date(weekStart);
          instanceDate.setDate(instanceDate.getDate() + dayOfWeek);
          if (instanceDate <= startBase) continue;
          if (instanceDate > endDate) break;

          // Apply the recurrence time or the original start time
          if (recurrenceTime) {
            const [h, m] = recurrenceTime.split(':').map(Number);
            instanceDate.setHours(h, m, 0, 0);
          } else {
            instanceDate.setHours(startBase.getHours(), startBase.getMinutes(), 0, 0);
          }

          const instanceStart = instanceDate.toISOString();
          const instanceEnd = new Date(instanceDate.getTime() + durationMs).toISOString();
          try {
            const instance = await this.createInternal(clinicId, staffId, { ...dto, startTime: instanceStart, endTime: instanceEnd });
            await db('appointments').where({ id: instance.id }).update({ recurrence_parent_id: parent.id, recurrence_rule: rule });
            results.push(instance);
          } catch { /* skip conflicts */ }
        }
        if (new Date(weekStart.getTime() + 7 * weekStep * 86400000) > endDate) break;
        weekStart.setDate(weekStart.getDate() + 7 * weekStep);
      }
    } else {
      // Simple interval-based (daily, monthly, or weekly without day selection)
      const intervalDays = rule === 'daily' ? 1 : rule === 'weekly' ? 7 : rule === 'fortnightly' ? 14 : rule === 'monthly' ? 30 : 7;
      let current = new Date(startBase);
      for (let i = 0; i < 52; i++) {
        current = new Date(current.getTime() + intervalDays * 86400000);
        if (current > endDate) break;
        // Apply recurrence time if specified
        if (recurrenceTime) {
          const [h, m] = recurrenceTime.split(':').map(Number);
          current.setHours(h, m, 0, 0);
        }
        const instanceStart = current.toISOString();
        const instanceEnd = new Date(current.getTime() + durationMs).toISOString();
        try {
          const instance = await this.createInternal(clinicId, staffId, { ...dto, startTime: instanceStart, endTime: instanceEnd });
          await db('appointments').where({ id: instance.id }).update({ recurrence_parent_id: parent.id, recurrence_rule: rule });
          results.push(instance);
        } catch { /* skip conflicts */ }
      }
    }

    return results;
  },

  async update(
    auth: AuthContext,
    id: string,
    dto: UpdateAppointmentDTOType,
  ): Promise<AppointmentResponseType> {
    const { clinicId } = auth;
    const existing = await appointmentRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, existing.patient_id);

    const existingStart = existing.appointment_start ?? existing.start_time;
    const existingEnd = existing.appointment_end ?? existing.end_time;
    const start = dto.startTime ? new Date(dto.startTime) : existingStart;
    const end = dto.endTime ? new Date(dto.endTime) : existingEnd;
    if (end <= start) {
      throw new AppError('End time must be after start time', 422, 'INVALID_TIME_RANGE');
    }
    await assertBookingGuardrails(clinicId, start, end);

    const newPrimaryClinicianId =
      dto.clinicianId ?? existing.clinician_id ?? '';
    const desiredAttendees = dto.attendeeStaffIds;

    // Phase 13 PR5 — multi-attendee conflict check. Run when
    // datetime OR primary OR attendee set changed. Resolves the
    // forward-looking attendee set so the check is against what
    // the appointment WILL look like, not the stale row.
    if (
      dto.startTime ||
      dto.endTime ||
      dto.clinicianId ||
      desiredAttendees !== undefined
    ) {
      const currentAttendeeRows =
        await appointmentAttendeeRepository.listForAppointment(clinicId, id);
      const currentCoIds = currentAttendeeRows
        .filter(
          (r) => r.role !== 'primary' && r.attendance_status !== 'removed',
        )
        .map((r) => r.staff_id);
      const futureCoIds = desiredAttendees ?? currentCoIds;
      const allFuture = Array.from(
        new Set(
          [newPrimaryClinicianId, ...futureCoIds].filter((s) => s.length > 0),
        ),
      );
      const overlaps =
        await appointmentAttendeeRepository.findOverlapsForStaff(
          clinicId,
          allFuture,
          { start, end },
          id,
        );
      if (overlaps.length > 0) {
        throw new AppError(
          'One or more clinicians are already booked during this time slot',
          409,
          'APPOINTMENT_CONFLICT',
        );
      }
    }

    const patch: Record<string, unknown> = {
      start_time: start,
      end_time: end,
      appointment_start: start,
      appointment_end: end,
      type: dto.type ?? existing.type ?? existing.appointment_type ?? 'follow_up',
      appointment_type: dto.type ?? existing.appointment_type,
      mode: dto.mode ?? existing.mode ?? null,
      notes: dto.notes ?? existing.notes,
      telehealth_url: dto.telehealthDetails?.telehealthLink ?? existing.telehealth_url,
      telehealth:
        (dto.mode ?? existing.mode) === 'telehealth'
        || (dto.mode ?? existing.mode) === 'videoconference'
        || dto.type === 'telehealth'
        || existing.type === 'telehealth',
    };

    if (dto.clinicianId) {
      patch.clinician_id = dto.clinicianId;
    }
    if (dto.episodeId !== undefined) {
      patch.episode_id = dto.episodeId;
    }

    // Phase 13 PR5 — wrap the appointment patch + attendee diff in
    // one transaction so partial failures roll back cleanly.
    const updated = await db.transaction(async (trx) => {
      const next = await appointmentRepository.update(trx, clinicId, id, patch);
      if (!next) {
        throw new AppError('Appointment not found after update', 404, 'NOT_FOUND');
      }

      // Promote / demote primary attendee row when clinician_id
      // changes. Demotion preserves history by flipping the old
      // primary's status to 'removed', not deleting it.
      if (
        dto.clinicianId &&
        existing.clinician_id &&
        dto.clinicianId !== existing.clinician_id
      ) {
        await appointmentAttendeeRepository.replacePrimary(
          trx,
          clinicId,
          id,
          dto.clinicianId,
        );
      }

      // Co-clinician diff. Only run when caller explicitly passed
      // attendeeStaffIds — undefined means "leave attendees alone".
      if (desiredAttendees !== undefined) {
        const currentRows =
          await appointmentAttendeeRepository.listForAppointment(clinicId, id, trx);
        const currentCoIds = new Set(
          currentRows
            .filter(
              (r) => r.role !== 'primary' && r.attendance_status !== 'removed',
            )
            .map((r) => r.staff_id),
        );
        const desired = new Set(
          desiredAttendees.filter((s) => s !== newPrimaryClinicianId),
        );

        const toAdd = [...desired].filter((s) => !currentCoIds.has(s));
        const toRemove = [...currentCoIds].filter((s) => !desired.has(s));

        if (toAdd.length > 0) {
          await appointmentAttendeeRepository.insertMany(
            trx,
            toAdd.map((staffId) => ({
              clinic_id: clinicId,
              appointment_id: id,
              staff_id: staffId,
              role: 'co_clinician' as const,
              attendance_status: 'required' as const,
            })),
          );
        }
        if (toRemove.length > 0) {
          await appointmentAttendeeRepository.markRemoved(
            trx,
            clinicId,
            id,
            toRemove,
          );
        }
      }

      return next;
    });

    await enqueueAppointmentCalendarSync({
      clinicId,
      appointmentId: id,
      clinicianId: newPrimaryClinicianId,
      patientId: existing.patient_id,
      appointmentType: String(
        dto.type ?? existing.type ?? existing.appointment_type ?? 'follow_up',
      ),
      mode: ((dto.mode ?? existing.mode ?? 'direct') as 'direct' | 'telehealth' | 'videoconference' | 'other'),
      startTimeIso: start.toISOString(),
      endTimeIso: end.toISOString(),
      notes: (dto.notes ?? existing.notes ?? null) as string | null,
      attendeeStaffIds:
        desiredAttendees
        ?? (
          await appointmentAttendeeRepository.listForAppointment(clinicId, id)
        )
          .filter((row) => row.attendance_status !== 'removed')
          .map((row) => row.staff_id),
      type: 'update',
    });

    const [enriched] = await enrichAppointmentRows(clinicId, [
      updated as unknown as Record<string, unknown>,
    ]);
    return mapDbToResponse(enriched);
  },

  async updateStatus(
    auth: AuthContext,
    id: string,
    nextStatus: AppointmentStatus,
  ): Promise<AppointmentResponseType> {
    const { clinicId } = auth;
    const existing = await appointmentRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, existing.patient_id);

    const allowedNext = allowedStatusTransitions[existing.status] ?? [];
    if (!allowedNext.includes(nextStatus)) {
      throw new AppError(
        `Invalid status transition from ${existing.status} to ${nextStatus}`,
        422,
        'INVALID_STATUS_TRANSITION',
      );
    }

    const updated = await appointmentRepository.update(db, clinicId, id, {
      status: nextStatus,
    });
    if (!updated) throw new AppError('Appointment not found after status update', 404, 'NOT_FOUND');

    // Auto-generate draft invoice when appointment is completed
    if (nextStatus === 'completed' && existing.patient_id) {
      try {
        const { dbAdmin } = await import('../../db/db');
        // Trigger if fee_schedules table has items for this clinic
        const hasFeeTable = await dbAdmin.schema.hasTable('fee_schedules');
        const hasFeeSchedules = hasFeeTable
          ? await dbAdmin('fee_schedules').where({ clinic_id: clinicId, is_active: true }).first()
          : null;

        if (hasFeeSchedules) {
          const { autoGenerateInvoice } = await import('../billing/billingService');
          const raw = existing as unknown as Record<string, unknown>;
          await autoGenerateInvoice(clinicId, String(existing.clinician_id ?? ''), {
            id,
            patientId: existing.patient_id,
            clinicianId: existing.clinician_id ?? '',
            type: String(raw['type'] ?? 'follow_up'),
            startTime: raw['start_time'] instanceof Date ? raw['start_time'].toISOString() : String(raw['start_time'] ?? ''),
            endTime: raw['end_time'] instanceof Date ? raw['end_time'].toISOString() : String(raw['end_time'] ?? ''),
          });
        }
      } catch (err) {
        const lgr = (await import('../../utils/logger')).default;
        lgr.warn({ err, clinicId, appointmentId: id }, 'Auto-invoice generation failed — manual creation required');
      }
    }

    const [enriched] = await enrichAppointmentRows(clinicId, [
      updated as unknown as Record<string, unknown>,
    ]);
    return mapDbToResponse(enriched);
  },

  async cancel(
    auth: AuthContext,
    id: string,
    reason?: string,
  ): Promise<AppointmentResponseType> {
    const { clinicId } = auth;
    const existing = await appointmentRepository.findById(clinicId, id);
    if (!existing) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, existing.patient_id);
    if (
      existing.status === 'completed' ||
      existing.status === 'cancelled' ||
      existing.status === 'no_show'
    ) {
      throw new AppError(
        'Cannot cancel an appointment that is already completed or inactive',
        422,
        'INVALID_STATUS_TRANSITION',
      );
    }

    const updated = await appointmentRepository.update(db, clinicId, id, {
      status: 'cancelled',
      cancellation_reason: reason ?? existing.cancellation_reason,
    });
    if (!updated) throw new AppError('Appointment not found after cancel', 404, 'NOT_FOUND');
    await enqueueAppointmentCalendarSync({
      clinicId,
      appointmentId: id,
      clinicianId: existing.clinician_id ?? auth.staffId,
      patientId: existing.patient_id,
      appointmentType: String(existing.type ?? existing.appointment_type ?? 'follow_up'),
      mode: ((existing.mode ?? 'direct') as 'direct' | 'telehealth' | 'videoconference' | 'other'),
      startTimeIso: (existingStart => existingStart instanceof Date ? existingStart.toISOString() : new Date(String(existingStart)).toISOString())(existing.appointment_start ?? existing.start_time),
      endTimeIso: (existingEnd => existingEnd instanceof Date ? existingEnd.toISOString() : new Date(String(existingEnd)).toISOString())(existing.appointment_end ?? existing.end_time),
      notes: existing.notes,
      type: 'delete',
    });
    try {
      const removed = await clearQueuedAppointmentReminders(clinicId, id);
      logger.info(
        {
          clinicId,
          appointmentId: id,
          emailRemoved: removed.emailRemoved,
          outreachRemoved: removed.outreachRemoved,
        },
        'appointmentService.cancel — cleared queued reminder jobs for cancelled appointment',
      );
    } catch (err) {
      logger.warn(
        { err, clinicId, appointmentId: id },
        'appointmentService.cancel — failed to clear queued reminder jobs',
      );
    }
    const [enriched] = await enrichAppointmentRows(clinicId, [
      updated as unknown as Record<string, unknown>,
    ]);
    return mapDbToResponse(enriched);
  },

  async getById(auth: AuthContext, id: string): Promise<AppointmentResponseType> {
    const existing = await appointmentRepository.findById(auth.clinicId, id);
    if (!existing) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
    await requirePatientReadAccess(auth, existing.patient_id);
    const [enriched] = await enrichAppointmentRows(auth.clinicId, [
      existing as unknown as Record<string, unknown>,
    ]);
    return mapDbToResponse(enriched);
  },

  async list(
    auth: AuthContext,
    filters: AppointmentSearchDTOType,
  ): Promise<AppointmentResponseType[]> {
    // When filters scope to a single patient, require relationship.
    // Calendar-wide reads (clinician's own schedule, department
    // roster) remain valid without the check since they don't narrow
    // to a single patient.
    if (filters.patientId) {
      await requirePatientReadAccess(auth, filters.patientId);
    }
    const rows = await appointmentRepository.list({
      clinicId: auth.clinicId,
      patientId: filters.patientId,
      clinicianId: filters.clinicianId,
      specialtyCode: filters.specialtyCode,
      status: filters.status as AppointmentStatus | undefined,
      from: filters.from ? new Date(filters.from) : undefined,
      to: filters.to ? new Date(filters.to) : undefined,
      limit: filters.limit,
      offset: filters.offset,
    });
    const enriched = await enrichAppointmentRows(
      auth.clinicId,
      rows as unknown as Array<Record<string, unknown>>,
    );
    return toResponseListSafe(enriched, auth.clinicId);
  },

  // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS-FOLLOWUP-DEAD-CODE-CLEANUP
  // (2026-05-03) — `scheduleReminders(clinicId, ...)` was removed here.
  // Method had ZERO callers across `apps/api/src` (verified) and held
  // a default-`db` settingsService.getThresholds call that would have
  // silently RLS-zero'd if revived in cron context (the harm class
  // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS just closed for 4 active
  // schedulers). L5 advisory: "DO NOT silently patch dead code; it
  // normalises preemptive defensive padding without a forcing test."
  // Patient-outreach (the production reminder pipeline) lives in
  // `apps/api/src/features/patient-outreach/patientOutreachService.ts`
  // and is wired from `apps/api/src/jobs/schedulers/`.
};
