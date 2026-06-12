// apps/api/src/features/appointments/appointmentController.ts
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/db';
import { appointmentService } from './appointmentService';
import { appointmentRepository } from './appointmentRepository';
import { appointmentAttendeeRepository } from './appointmentAttendeeRepository';
import { AppError } from '../../shared/errors';
import { buildAuthContext } from '../../shared/buildAuthContext';
import {
  AppointmentSearchDTO,
  AppointmentStatusSchema,
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
} from '@signacare/shared';

// ── Local Zod schemas for endpoints not covered by the create/update DTOs ──
// Each schema is local per CLAUDE.md §12.
const UpdateStatusBodySchema = z.object({
  status: AppointmentStatusSchema,
});

const CancelBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

const RecurrenceFieldsSchema = z.object({
  // Expanded RRULE string per iCalendar RFC 5545 (FREQ=WEEKLY;COUNT=n etc).
  recurrenceRule: z.string().min(1).max(500),
  recurrenceEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});

const AttendeeRoleEnum = z.enum([
  'primary',
  'co_clinician',
  'supervisor',
  'observer',
  'interpreter',
  'support',
]);
const AttendanceStatusEnum = z.enum([
  'required',
  'accepted',
  'tentative',
  'declined',
  'attended',
  'did_not_attend',
  'removed',
]);
const AddAttendeeBodySchema = z.object({
  staffId: z.string().uuid(),
  role: AttendeeRoleEnum.default('co_clinician'),
});
const PatchAttendeeBodySchema = z.object({
  role: AttendeeRoleEnum.optional(),
  attendanceStatus: AttendanceStatusEnum.optional(),
});

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function normaliseAppointmentDateQuery(
  value: unknown,
  boundary: 'from' | 'to',
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!DATE_ONLY_REGEX.test(trimmed)) return trimmed;
  return boundary === 'from'
    ? `${trimmed}T00:00:00.000Z`
    : `${trimmed}T23:59:59.999Z`;
}

export const appointmentController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const dto = CreateAppointmentDTO.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const appointment = await appointmentService.create(auth, dto);
      res.status(201).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const dto = UpdateAppointmentDTO.parse(req.body);
      const auth = buildAuthContext(req);
      const appointment = await appointmentService.update(auth, id, dto);
      res.json(appointment);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status } = UpdateStatusBodySchema.parse(req.body);
      const auth = buildAuthContext(req);
      const appointment = await appointmentService.updateStatus(auth, id, status);
      res.json(appointment);
    } catch (err) {
      next(err);
    }
  },

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = CancelBodySchema.parse(req.body);
      const auth = buildAuthContext(req);
      const appointment = await appointmentService.cancel(auth, id, reason);
      res.json(appointment);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const auth = buildAuthContext(req);
      const appointment = await appointmentService.getById(auth, id);
      res.json(appointment);
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = AppointmentSearchDTO.parse({
        patientId: req.query['patientId'],
        clinicianId: req.query['clinicianId'],
        status: req.query['status'],
        from: normaliseAppointmentDateQuery(req.query['from'], 'from'),
        to: normaliseAppointmentDateQuery(req.query['to'], 'to'),
        limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
        offset: req.query['offset'] ? Number(req.query['offset']) : undefined,
      });
      const auth = buildAuthContext(req, query.patientId ?? undefined);
      const appointments = await appointmentService.list(auth, query);
      res.json(appointments);
    } catch (err) {
      next(err);
    }
  },

  async createRecurring(req: Request, res: Response, next: NextFunction) {
    try {
      const dto = CreateAppointmentDTO.parse(req.body);
      const { recurrenceRule, recurrenceEndDate } = RecurrenceFieldsSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const appointments = await appointmentService.createRecurring(auth, { ...dto, recurrenceRule, recurrenceEndDate });
      res.status(201).json({ appointments, count: appointments.length });
    } catch (err) {
      next(err);
    }
  },

  // Phase 13 PR5 — attendee endpoints. Every read/write filters by
  // clinic_id (CLAUDE.md §1.3). Attendee mutations live behind the
  // existing appointment:update permission tier; reads behind
  // appointment:read.
  async listAttendees(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const { id } = req.params;
      // Verify the appointment exists in this clinic before
      // returning attendee rows so a stale id leaks no information.
      const apt = await appointmentRepository.findById(clinicId, id);
      if (!apt) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
      const rows = await appointmentAttendeeRepository.listForAppointment(
        clinicId,
        id,
      );
      res.json({
        attendees: rows.map((r) => ({
          id: r.id,
          appointmentId: r.appointment_id,
          staffId: r.staff_id,
          staffName:
            `${r.staff_given_name ?? ''} ${r.staff_family_name ?? ''}`.trim(),
          role: r.role,
          attendanceStatus: r.attendance_status,
          invitedAt: r.invited_at.toISOString(),
          respondedAt: r.responded_at ? r.responded_at.toISOString() : null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  async addAttendee(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const { id } = req.params;
      const body = AddAttendeeBodySchema.parse(req.body);

      const apt = await appointmentRepository.findById(clinicId, id);
      if (!apt) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
      const overlapStart = apt.appointment_start ?? apt.start_time;
      const overlapEnd = apt.appointment_end ?? apt.end_time;
      if (!overlapStart || !overlapEnd) {
        throw new AppError(
          'Appointment time range is missing',
          500,
          'RESPONSE_SHAPE_ERROR',
          { appointmentId: id },
        );
      }

      // Conflict check against the new attendee's existing schedule.
      const overlaps =
        await appointmentAttendeeRepository.findOverlapsForStaff(
          clinicId,
          [body.staffId],
          {
            start: overlapStart,
            end: overlapEnd,
          },
          id,
        );
      if (overlaps.length > 0) {
        throw new AppError(
          'Selected clinician is already booked during this time slot',
          409,
          'APPOINTMENT_CONFLICT',
        );
      }

      await db.transaction(async (trx) => {
        await appointmentAttendeeRepository.addAttendee(trx, {
          clinic_id: clinicId,
          appointment_id: id,
          staff_id: body.staffId,
          role: body.role,
        });
      });
      res.status(201).json({ added: true });
    } catch (err) {
      next(err);
    }
  },

  async patchAttendee(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const { id, staffId } = req.params;
      const body = PatchAttendeeBodySchema.parse(req.body);
      if (!body.role && !body.attendanceStatus) {
        throw new AppError(
          'Provide at least one of role or attendanceStatus',
          400,
          'VALIDATION_ERROR',
        );
      }
      const updated = await appointmentAttendeeRepository.updateAttendee(
        db,
        clinicId,
        id,
        staffId,
        {
          ...(body.role ? { role: body.role } : {}),
          ...(body.attendanceStatus
            ? { attendance_status: body.attendanceStatus }
            : {}),
        },
      );
      if (updated === 0) {
        throw new AppError('Attendee not found', 404, 'NOT_FOUND');
      }
      res.json({ updated: true });
    } catch (err) {
      next(err);
    }
  },

  async removeAttendee(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const { id, staffId } = req.params;
      // Refuse to remove the primary clinician via this path — the
      // primary swap goes through the appointment update flow so
      // it's atomic with a replacement.
      const rows = await appointmentAttendeeRepository.listForAppointment(
        clinicId,
        id,
      );
      const target = rows.find((r) => r.staff_id === staffId);
      if (!target) {
        throw new AppError('Attendee not found', 404, 'NOT_FOUND');
      }
      if (target.role === 'primary') {
        throw new AppError(
          'Cannot remove the primary clinician — update the appointment with a new clinicianId instead',
          422,
          'PRIMARY_NOT_REMOVABLE',
        );
      }
      await appointmentAttendeeRepository.markRemoved(db, clinicId, id, [
        staffId,
      ]);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
