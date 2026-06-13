// apps/api/src/features/calendar/calendarController.ts
//
// Phase 13 PR2b — thin Express controllers for the calendar API.
// Each method follows the CLAUDE.md §3.1 convention: try/catch +
// next(err) on failure. Validation uses the Zod schemas from
// @signacare/shared so the wire format matches what the frontend
// imports.

import type { NextFunction, Request, Response } from 'express';
import {
  AppointmentSearchDTO,
  AppointmentResponse,
  AvailabilityBlockCreateSchema,
  AvailabilityBlockUpdateSchema,
  CalendarPreferencesSchema,
} from '@signacare/shared';
import { appointmentService } from '../appointments/appointmentService';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { calendarService } from './calendarService';

function requireClinicId(req: Request): string {
  const id = req.clinicId;
  if (!id || typeof id !== 'string') {
    throw new Error('clinic_id missing from request context');
  }
  return id;
}

function requireStaffId(req: Request): string {
  const staffId = (req.user as { id?: string } | undefined)?.id;
  if (!staffId) {
    throw new Error('staff id missing from request context');
  }
  return staffId;
}

function resolveClinicianId(req: Request): string {
  // Query string lets admins read other clinicians' calendars.
  // Without a query override, the caller reads their own.
  const q = typeof req.query['clinicianId'] === 'string'
    ? (req.query['clinicianId'] as string)
    : undefined;
  return q ?? requireStaffId(req);
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const CalendarAppointmentsListResponseSchema = AppointmentResponse.array().transform((appointments) => ({ appointments }));

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

export const calendarController = {
  async listAppointments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = AppointmentSearchDTO.parse({
        patientId: req.query['patientId'],
        clinicianId: req.query['clinicianId'],
        specialtyCode: req.query['specialtyCode'],
        status: req.query['status'],
        from: normaliseAppointmentDateQuery(req.query['from'], 'from'),
        to: normaliseAppointmentDateQuery(req.query['to'], 'to'),
        limit: req.query['limit'] ? Number(req.query['limit']) : undefined,
        offset: req.query['offset'] ? Number(req.query['offset']) : undefined,
      });
      const auth = buildAuthContext(req, query.patientId ?? undefined);
      const appointments = await appointmentService.list(auth, query);
      res.json(CalendarAppointmentsListResponseSchema.parse(appointments));
    } catch (err) {
      next(err);
    }
  },

  async listBlocks(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const clinicianId = resolveClinicianId(req);
      const from = typeof req.query['from'] === 'string' ? (req.query['from'] as string) : undefined;
      const to = typeof req.query['to'] === 'string' ? (req.query['to'] as string) : undefined;
      const blocks = await calendarService.listAvailabilityBlocks({
        clinicId,
        clinicianId,
        from,
        to,
      });
      res.json({ blocks });
    } catch (err) {
      next(err);
    }
  },

  async createBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const staffId = requireStaffId(req);
      const parsed = AvailabilityBlockCreateSchema.parse(req.body);
      const block = await calendarService.createAvailabilityBlock({
        clinic_id: clinicId,
        clinician_id: staffId,
        colour: parsed.colour,
        recurrence: parsed.recurrence,
        day_of_week: parsed.dayOfWeek,
        specific_date: parsed.specificDate,
        start_time: parsed.startTime,
        end_time: parsed.endTime,
        effective_from: parsed.effectiveFrom,
        effective_until: parsed.effectiveUntil,
        label: parsed.label,
        notes: parsed.notes,
        created_by_staff_id: staffId,
      });
      res.status(201).json(block);
    } catch (err) {
      next(err);
    }
  },

  async updateBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const id = req.params['id'] as string;
      const parsed = AvailabilityBlockUpdateSchema.parse(req.body);
      const block = await calendarService.updateAvailabilityBlock(clinicId, id, {
        colour: parsed.colour,
        recurrence: parsed.recurrence,
        day_of_week: parsed.dayOfWeek,
        specific_date: parsed.specificDate,
        start_time: parsed.startTime,
        end_time: parsed.endTime,
        effective_from: parsed.effectiveFrom,
        effective_until: parsed.effectiveUntil,
        label: parsed.label,
        notes: parsed.notes,
      });
      res.json(block);
    } catch (err) {
      next(err);
    }
  },

  async deleteBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const id = req.params['id'] as string;
      await calendarService.softDeleteAvailabilityBlock(clinicId, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async getPreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const staffId = requireStaffId(req);
      const prefs = await calendarService.getCalendarPreferences(staffId);
      res.json(prefs);
    } catch (err) {
      next(err);
    }
  },

  async updatePreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const staffId = requireStaffId(req);
      const parsed = CalendarPreferencesSchema.partial().parse(req.body);
      const prefs = await calendarService.updateCalendarPreferences(staffId, parsed);
      res.json(prefs);
    } catch (err) {
      next(err);
    }
  },

  async rotateIcalToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const staffId = requireStaffId(req);
      const result = await calendarService.rotateIcalToken(clinicId, staffId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getIcalSubscriptionUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const staffId = requireStaffId(req);
      const result = await calendarService.getOrMintIcalToken(clinicId, staffId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getToday(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = requireClinicId(req);
      const clinicianId = resolveClinicianId(req);
      const rawDate = typeof req.query['date'] === 'string' ? (req.query['date'] as string) : '';
      // Expect YYYY-MM-DD; default to today in the server's local
      // time zone if missing. Strict regex rejects garbage like `today`.
      const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);
      const today = await calendarService.getTodayView(clinicId, clinicianId, isoDate);
      res.json(today);
    } catch (err) {
      next(err);
    }
  },
};
