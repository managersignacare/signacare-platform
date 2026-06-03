import { z } from 'zod';

export const CreateBedSchema = z.object({
  ward: z.string().min(1).max(200),
  bedNumber: z.string().min(1).max(50).optional(),
  bed_number: z.string().min(1).max(50).optional(),
  bedType: z.string().max(50).optional(),
  bed_type: z.string().max(50).optional(),
});
export type CreateBedDTO = z.infer<typeof CreateBedSchema>;

export const BulkCreateBedsSchema = z.object({
  beds: z.array(z.object({
    ward: z.string().min(1).max(200),
    bed_number: z.string().min(1).max(50),
    bed_type: z.string().max(50).optional(),
  })).min(1).max(200),
});
export type BulkCreateBedsDTO = z.infer<typeof BulkCreateBedsSchema>;

export const UpdateBedSchema = z.object({
  status: z.enum(['available', 'occupied', 'maintenance', 'closed']).optional(),
  ward: z.string().max(200).optional(),
  bedType: z.string().max(50).optional(),
  bed_type: z.string().max(50).optional(),
});
export type UpdateBedDTO = z.infer<typeof UpdateBedSchema>;

export const AdmitPatientSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});
export type AdmitPatientDTO = z.infer<typeof AdmitPatientSchema>;

export const DischargeFromBedSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});
export type DischargeFromBedDTO = z.infer<typeof DischargeFromBedSchema>;

export const BedLeaveSchema = z.object({
  notes: z.string().max(2000).optional().nullable(),
});
export type BedLeaveDTO = z.infer<typeof BedLeaveSchema>;

export const CreateRestrictiveInterventionSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional().nullable(),
  interventionType: z.string().min(1).max(200),
  reason: z.string().max(2000).optional().nullable(),
  alternativesTried: z.string().max(2000).optional().nullable(),
});
export type CreateRestrictiveInterventionDTO = z.infer<typeof CreateRestrictiveInterventionSchema>;

export const EndRestrictiveInterventionSchema = z.object({
  // BUG-PR-R1-12-FIX-S0-restrictive_interventions — REQUIRED
  // expectedLockVersion per CLAUDE.md §1.6. High-harm class (MHA
  // evidentiary integrity); REQUIRED posture matches BUG-371b
  // prescribing surfaces. Helper throws AppError(409,
  // 'OPTIMISTIC_LOCK_CONFLICT') if mismatched.
  expectedLockVersion: z.number().int().positive(),
  outcome: z.string().max(2000).optional().nullable(),
  debriefCompleted: z.boolean().optional(),
  debriefNotes: z.string().max(5000).optional().nullable(),
  notifiedPersons: z.string().max(2000).optional().nullable(),
});
export type EndRestrictiveInterventionDTO = z.infer<typeof EndRestrictiveInterventionSchema>;
