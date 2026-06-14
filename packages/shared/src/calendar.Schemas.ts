// packages/shared/src/calendar.Schemas.ts
//
// Phase 13 — per-clinician calendar shared types. Every backend
// route, every frontend hook, and every Sara sync field reads its
// shape from this file. Breaking a shape here breaks both sides
// at compile time, which is the whole point of the @signacare/shared
// convention.

import { z } from 'zod';

// ── Availability blocks ───────────────────────────────────────────

export const AvailabilityColourSchema = z.enum(['red', 'yellow', 'green']);
export type AvailabilityColour = z.infer<typeof AvailabilityColourSchema>;

export const RecurrenceSchema = z.enum(['none', 'weekly', 'fortnightly']);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const AvailabilityBlockSchema = z.object({
  id: z.string().uuid(),
  clinicianId: z.string().uuid(),
  colour: AvailabilityColourSchema,
  recurrence: RecurrenceSchema,
  dayOfWeek: z.number().int().min(0).max(6).nullable(),
  specificDate: z.string().nullable(), // ISO YYYY-MM-DD
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  label: z.string().max(200).nullable(),
  notes: z.string().max(2000).nullable(),
});
export type AvailabilityBlock = z.infer<typeof AvailabilityBlockSchema>;

// Base (un-refined) object — used as the source for both the
// create DTO (full + refine rules) and the update DTO (partial,
// no refine because individual field updates shouldn't have to
// re-validate the whole shape).
const AvailabilityBlockBaseSchema = AvailabilityBlockSchema.omit({
  id: true,
  clinicianId: true,
});

export const AvailabilityBlockCreateSchema = AvailabilityBlockBaseSchema
  .refine(
    (v) =>
      ((v.recurrence === 'weekly' || v.recurrence === 'fortnightly') &&
        v.dayOfWeek !== null &&
        v.specificDate === null) ||
      (v.recurrence === 'none' &&
        v.dayOfWeek === null &&
        v.specificDate !== null),
    {
      message:
        "recurrence='weekly'/'fortnightly' requires dayOfWeek; recurrence='none' requires specificDate",
    },
  )
  .refine((v) => v.endTime > v.startTime, {
    message: 'endTime must be later than startTime',
    path: ['endTime'],
  });
export type AvailabilityBlockCreateDTO = z.infer<
  typeof AvailabilityBlockCreateSchema
>;

export const AvailabilityBlockUpdateSchema = AvailabilityBlockBaseSchema.partial();
export type AvailabilityBlockUpdateDTO = z.infer<
  typeof AvailabilityBlockUpdateSchema
>;

// ── Calendar preferences (per-clinician) ──────────────────────────

export const CalendarSlotMinutesSchema = z.union([
  z.literal(15),
  z.literal(20),
  z.literal(30),
  z.literal(45),
  z.literal(60),
]);

export const CalendarPreferencesSchema = z.object({
  slotMinutes: CalendarSlotMinutesSchema.default(30),
  weekStart: z.number().int().min(0).max(6).default(1),
  icalToken: z.string().optional(),
  icalTokenIssuedAt: z.string().datetime().optional(),
});
export type CalendarPreferences = z.infer<typeof CalendarPreferencesSchema>;

// ── Appointment attendees (multi-clinician junction) ──────────────

export const AppointmentAttendeeRoleSchema = z.enum([
  'primary',
  'co_clinician',
  'supervisor',
  'observer',
  'interpreter',
  'support',
]);
export type AppointmentAttendeeRole = z.infer<
  typeof AppointmentAttendeeRoleSchema
>;

export const AppointmentAttendanceStatusSchema = z.enum([
  'required',
  'accepted',
  'tentative',
  'declined',
  'attended',
  'did_not_attend',
  'removed',
]);
export type AppointmentAttendanceStatus = z.infer<
  typeof AppointmentAttendanceStatusSchema
>;

export const AppointmentAttendeeSchema = z.object({
  id: z.string().uuid(),
  appointmentId: z.string().uuid(),
  staffId: z.string().uuid(),
  staffName: z.string(),
  role: AppointmentAttendeeRoleSchema,
  attendanceStatus: AppointmentAttendanceStatusSchema,
  invitedAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable(),
});
export type AppointmentAttendee = z.infer<typeof AppointmentAttendeeSchema>;

// ── Today view response (backend aggregate) ───────────────────────

export const ContactRecordSummarySchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  contactDate: z.string(),
  durationMinutes: z.number().int().nonnegative(),
  status: z.string(),
});
export type ContactRecordSummary = z.infer<typeof ContactRecordSummarySchema>;

export const TodayViewCountsSchema = z.object({
  scheduled: z.number().int().nonnegative(),
  confirmed: z.number().int().nonnegative(),
  arrived: z.number().int().nonnegative(),
  inSession: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  noShow: z.number().int().nonnegative(),
  contactsDraft: z.number().int().nonnegative(),
  contactsSigned: z.number().int().nonnegative(),
});
export type TodayViewCounts = z.infer<typeof TodayViewCountsSchema>;

// Minimal appointment shape rendered by the today view. The full
// AppointmentResponseSchema lives in appointment.Schemas.ts and is
// a fatter shape with specialty_code, telehealth, etc — this
// projection only exposes the fields the today-view grid actually
// reads, so a refactor of the full schema doesn't ripple through
// the today endpoint unless a field is added here too.
export const TodayViewAppointmentSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  clinicianId: z.string().uuid().nullable(),
  appointmentStart: z.string().datetime(),
  appointmentEnd: z.string().datetime(),
  appointmentType: z.string(),
  status: z.string(),
  telehealth: z.boolean(),
  notes: z.string().nullable(),
});
export type TodayViewAppointment = z.infer<typeof TodayViewAppointmentSchema>;

export const TodayViewResponseSchema = z.object({
  date: z.string(),           // ISO YYYY-MM-DD
  clinicianId: z.string().uuid(),
  clinicianName: z.string(),
  availabilityBlocks: z.array(AvailabilityBlockSchema),
  appointments: z.array(TodayViewAppointmentSchema),
  dnas: z.array(TodayViewAppointmentSchema),
  contacts: z.array(ContactRecordSummarySchema),
  counts: TodayViewCountsSchema,
});
export type TodayViewResponse = z.infer<typeof TodayViewResponseSchema>;
