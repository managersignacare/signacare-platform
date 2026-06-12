// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AppointmentsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicianId: z.string().uuid(),
  staffId: z.string().uuid().nullable().optional(),
  episodeId: z.string().uuid().nullable().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  appointmentStart: z.string().datetime().nullable().optional(),
  appointmentEnd: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().nullable().optional(),
  status: z.string().max(50),
  type: z.string().max(50),
  appointmentType: z.string().max(50).nullable().optional(),
  mode: z.string().max(50).nullable().optional(),
  mbsItem: z.string().max(20).nullable().optional(),
  patientResponse: z.string().max(50).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  notes: z.string().nullable().optional(),
  telehealth: z.boolean().nullable().optional(),
  telehealthUrl: z.string().max(500).nullable().optional(),
  telehealthLink: z.string().max(500).nullable().optional(),
  telehealthProvider: z.string().max(100).nullable().optional(),
  telehealthPasscode: z.string().max(100).nullable().optional(),
  cancellationReason: z.string().max(500).nullable().optional(),
  cancelledById: z.string().uuid().nullable().optional(),
  rescheduledFromId: z.string().uuid().nullable().optional(),
  reminderScheduled: z.boolean(),
  reminderSent: z.boolean(),
  reminderSentAt: z.string().datetime().nullable().optional(),
  outlookEventId: z.string().max(255).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  recurrenceRule: z.string().max(30).nullable().optional(),
  recurrenceEndDate: z.string().nullable().optional(),
  recurrenceParentId: z.string().uuid().nullable().optional(),
  specialtyCode: z.string().max(40),
  checkInAt: z.string().datetime().nullable().optional(),
  checkedInById: z.string().uuid().nullable().optional(),
  lockVersion: z.number().int(),
  outlookChangeKey: z.string().max(255).nullable().optional(),
  outlookLastSyncedAt: z.string().datetime().nullable().optional(),
  outlookLastModifiedAt: z.string().datetime().nullable().optional(),
  outlookSyncStatus: z.string().max(30),
  outlookSyncError: z.string().nullable().optional(),
});

export type AppointmentsDtoScaffold = z.infer<typeof AppointmentsDtoScaffoldSchema>;
