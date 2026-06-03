// packages/shared/src/flag.schemas.ts
import { z } from 'zod';

export const PatientFlagCategoryEnum = z.enum([
  'safety', 'clinical', 'legal', 'lai_overdue', 'clozapine_red',
  'mha_expiry', 'mha_review_due', 'allergy', 'other',
]);

export const PatientFlagSeverityEnum = z.enum(['low', 'medium', 'high', 'critical']);

export const PatientFlagCreateSchema = z.object({
  patientId:         z.string().uuid(),
  episodeId:         z.string().uuid().optional(),
  category:          PatientFlagCategoryEnum,
  severity:          PatientFlagSeverityEnum.default('medium'),
  title:             z.string().min(1).max(255),
  description:       z.string().optional(),
  relatedRecordType: z.string().max(50).optional(),
  relatedRecordId:   z.string().uuid().optional(),
  isHeaderFlag:      z.boolean().default(true),
});
export type PatientFlagCreateDTO = z.infer<typeof PatientFlagCreateSchema>;

export const PatientFlagResponseSchema = PatientFlagCreateSchema.extend({
  id:                z.string().uuid(),
  clinicId:          z.string().uuid(),
  status:            z.enum(['active', 'resolved']),
  raisedByStaffId:   z.string().uuid().nullable(),
  resolvedByStaffId: z.string().uuid().nullable(),
  raisedAt:          z.string(),
  resolvedAt:        z.string().nullable(),
  createdAt:         z.string(),
  updatedAt:         z.string(),
});
export type PatientFlagResponse = z.infer<typeof PatientFlagResponseSchema>;
