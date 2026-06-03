import { z } from 'zod';

export const EscalationPrioritySchema = z.enum(['routine', 'urgent', 'emergency']);
export type EscalationPriority = z.infer<typeof EscalationPrioritySchema>;

export const EscalationStatusSchema = z.enum([
  'open',
  'in_progress',
  'resolved',
  'closed',
  'reopened',
]);
export type EscalationStatus = z.infer<typeof EscalationStatusSchema>;

export const EscalationEventTypeSchema = z.enum([
  'created',
  'acknowledged',
  'updated',
  'note_added',
  'team_changed',
  'resolved',
  'closed',
  'reopened',
  'in_progress',
]);
export type EscalationEventType = z.infer<typeof EscalationEventTypeSchema>;

export const IsbarSchema = z.object({
  // ISBAR stands for Identify / Situation / Background / Assessment /
  // Recommendation. The `identify` field is optional because legacy
  // callers (pre-ISBAR-5-field) don't include it; new callers include
  // the identity of the patient + clinician at the start of the handover.
  identify:       z.string().optional(),
  situation:      z.string().min(1, 'Situation is required'),
  background:     z.string().min(1, 'Background is required'),
  assessment:     z.string().min(1, 'Assessment is required'),
  recommendation: z.string().min(1, 'Recommendation is required'),
});
export type Isbar = z.infer<typeof IsbarSchema>;

export const CreateEscalationSchema = z.object({
  patientId:    z.string().uuid(),
  episodeId:    z.string().uuid().optional(),
  assignedTeam: z.string().min(1, 'Assigned team is required'),
  priority:     EscalationPrioritySchema.default('routine'),
  isbar:        IsbarSchema,
});
export type CreateEscalationDTO = z.infer<typeof CreateEscalationSchema>;

export const UpdateEscalationSchema = z.object({
  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion per
  // CLAUDE.md §1.6. ISBAR concurrency protection — high-harm clinical
  // path. REQUIRED posture matches BUG-371b prescribing surfaces.
  expectedLockVersion: z.number().int().positive(),
  assignedTeam: z.string().min(1).optional(),
  priority:     EscalationPrioritySchema.optional(),
  notes:        z.string().optional(),
});
export type UpdateEscalationDTO = z.infer<typeof UpdateEscalationSchema>;

export const EscalationEventResponseSchema = z.object({
  id:           z.string().uuid(),
  escalationId: z.string().uuid(),
  actorId:      z.string().uuid(),
  actorName:    z.string(),
  eventType:    EscalationEventTypeSchema,
  notes:        z.string().nullable(),
  createdAt:    z.string().datetime(),
});
export type EscalationEventResponse = z.infer<typeof EscalationEventResponseSchema>;

// --- Resolve escalation ---
export const ResolveEscalationSchema = z.object({
  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion.
  expectedLockVersion: z.number().int().positive(),
  notes: z.string().max(5000).optional(),
});
export type ResolveEscalationDTO = z.infer<typeof ResolveEscalationSchema>;

// --- Add note to escalation ---
export const AddEscalationNoteSchema = z.object({
  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion.
  expectedLockVersion: z.number().int().positive(),
  notes: z.string().min(1).max(5000),
});
export type AddEscalationNoteDTO = z.infer<typeof AddEscalationNoteSchema>;

// --- Reject transfer ---
export const RejectTransferSchema = z.object({
  rejectionReason: z.string().max(2000).optional().nullable(),
});
export type RejectTransferDTO = z.infer<typeof RejectTransferSchema>;

export const EscalationResponseSchema = z.object({
  id:                  z.string().uuid(),
  clinicId:            z.string().uuid(),
  patientId:           z.string().uuid(),
  episodeId:           z.string().uuid().nullable(),
  raisedById:          z.string().uuid(),
  raisedByName:        z.string(),
  assignedTeam:        z.string(),
  priority:            EscalationPrioritySchema,
  status:              EscalationStatusSchema,
  isbar: z.object({
    situation:      z.string(),
    background:     z.string(),
    assessment:     z.string(),
    recommendation: z.string(),
  }),
  acknowledgedAt:      z.string().datetime().nullable(),
  acknowledgedById:    z.string().uuid().nullable(),
  resolvedAt:          z.string().datetime().nullable(),
  resolvedById:        z.string().uuid().nullable(),
  createdAt:           z.string().datetime(),
  updatedAt:           z.string().datetime(),
  // BUG-PR-R1-12-FIX-S1-escalations — opt-lock version. Frontend MUST
  // echo back as expectedLockVersion on update / resolve / addNote.
  lockVersion:         z.number().int().nonnegative(),
  events:              z.array(EscalationEventResponseSchema),
});
export type EscalationResponse = z.infer<typeof EscalationResponseSchema>;
