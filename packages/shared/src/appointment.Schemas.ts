// packages/shared/src/appointments/appointmentSchemas.ts
import { z } from 'zod';
import { SpecialtyTypeEnum } from './specialty.schemas';

export const AppointmentStatusSchema = z.enum([
  'scheduled',
  'confirmed',
  'arrived',
  'in_session',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
]);

export const AppointmentTypeSchema = z.enum([
  'initial',
  'follow_up',
  'assessment',
  'telehealth',
  'group',
  'clinical_review',
]);

export const CreateAppointmentDTO = z.object({
  patientId: z.string().uuid(),
  clinicianId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  /** Multi-specialty: the specialty this appointment belongs to. The
   *  server auto-resolves from the linked episode or the clinician's
   *  primary enrolment when omitted. */
  specialtyCode: SpecialtyTypeEnum.optional(),
  startTime: z.string(),
  endTime: z.string(),
  type: AppointmentTypeSchema.optional(),
  notes: z.string().max(5000).optional(),
  telehealthDetails: z
    .object({
      telehealthLink: z.string().url().max(500),
      telehealthProvider: z.string().max(100).optional(),
      telehealthPasscode: z.string().max(100).optional(),
    })
    .optional(),
  /** Phase 13 PR5 — additional clinicians participating as
   *  co_clinician attendees. The primary clinician is still
   *  `clinicianId`; every id here gets an `appointment_attendees`
   *  row with role='co_clinician'. Overlap detection runs against
   *  all attendees, not just the primary. */
  attendeeStaffIds: z.array(z.string().uuid()).max(20).optional(),
});

export const UpdateAppointmentDTO = z.object({
  clinicianId: z.string().uuid().optional(),
  episodeId: z.string().uuid().nullable().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  type: AppointmentTypeSchema.optional(),
  notes: z.string().max(5000).optional(),
  telehealthDetails: z
    .object({
      telehealthLink: z.string().url().max(500),
      telehealthProvider: z.string().max(100).optional(),
      telehealthPasscode: z.string().max(100).optional(),
    })
    .optional(),
  /** Phase 13 PR5 — replace the co_clinician attendee set. The
   *  service diffs against the existing rows: ids in the array but
   *  not in the DB get inserted, ids in the DB but not in the array
   *  get marked attendance_status='removed'. Omit this field to
   *  leave attendees untouched. */
  attendeeStaffIds: z.array(z.string().uuid()).max(20).optional(),
});

export const AppointmentResponse = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicianId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  specialtyCode: SpecialtyTypeEnum.nullable().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: AppointmentStatusSchema,
  type: AppointmentTypeSchema,
  patientResponse: z.enum(['attending', 'not_attending']).nullable().optional(),
  notes: z.string().nullable().optional(),
  telehealthLink: z.string().nullable().optional(),
  telehealthProvider: z.string().nullable().optional(),
  telehealthPasscode: z.string().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
  rescheduledFromId: z.string().uuid().nullable().optional(),
  reminderScheduled: z.boolean(),
  reminderSent: z.boolean(),
  reminderSentAt: z.string().datetime().nullable().optional(),
  outlookEventId: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const AppointmentSearchDTO = z.object({
  patientId: z.string().uuid().optional(),
  clinicianId: z.string().uuid().optional(),
  specialtyCode: SpecialtyTypeEnum.optional(),
  status: AppointmentStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

// Type aliases for all schemas
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;
export type AppointmentType = z.infer<typeof AppointmentTypeSchema>;
export type CreateAppointmentDTO = z.infer<typeof CreateAppointmentDTO>;
export type UpdateAppointmentDTO = z.infer<typeof UpdateAppointmentDTO>;
export type AppointmentResponse = z.infer<typeof AppointmentResponse>;
export type AppointmentSearchDTO = z.infer<typeof AppointmentSearchDTO>;

// ── Waitlist Schemas ──────────────────────────────────────────────────────────

export const WaitlistPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export const WaitlistStatusSchema = z.enum(['waiting', 'offered', 'converted', 'expired', 'withdrawn']);

export const WaitlistCreateDTO = z.object({
  patientId: z.string().uuid(),
  referralId: z.string().uuid().optional(),
  preferredClinicianId: z.string().uuid().optional(),
  priority: WaitlistPrioritySchema.default('medium'),
  preferredTimeOfDay: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
  preferredStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  preferredEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  targetAppointmentBy: z.string().date().optional(),
  notes: z.string().max(5000).optional(),
});

export const WaitlistUpdateDTO = z.object({
  preferredClinicianId: z.string().uuid().optional(),
  priority: WaitlistPrioritySchema.optional(),
  preferredTimeOfDay: z.enum(['morning', 'afternoon', 'evening', 'any']).optional(),
  preferredStartTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  preferredEndTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  targetAppointmentBy: z.string().date().optional(),
  status: WaitlistStatusSchema.optional(),
  notes: z.string().max(5000).optional(),
});

export const WaitlistEntryResponse = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  referralId: z.string().uuid().nullable().optional(),
  preferredClinicianId: z.string().uuid().nullable().optional(),
  priority: WaitlistPrioritySchema,
  preferredTimeOfDay: z.enum(['morning', 'afternoon', 'evening', 'any']).nullable().optional(),
  preferredStartTime: z.string().nullable().optional(),
  preferredEndTime: z.string().nullable().optional(),
  addedDate: z.string().date(),
  targetAppointmentBy: z.string().date().nullable().optional(),
  status: WaitlistStatusSchema,
  convertedAppointmentId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type WaitlistCreateDTO = z.infer<typeof WaitlistCreateDTO>;
export type WaitlistUpdateDTO = z.infer<typeof WaitlistUpdateDTO>;
export type WaitlistEntryResponse = z.infer<typeof WaitlistEntryResponse>;
