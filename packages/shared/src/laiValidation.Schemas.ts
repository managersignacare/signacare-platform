import { z } from 'zod';

export const CreateLaiValidationSchema = z.object({
  laiScheduleId: z.string().uuid(),
  patientId: z.string().uuid(),
  validationDate: z.string().min(1),
  validationType: z.enum(['pre_injection', 'post_injection', 'blood_test', 'assessment']),
  bloodPressureSystolic: z.number().int().positive().optional(),
  bloodPressureDiastolic: z.number().int().positive().optional(),
  heartRate: z.number().int().positive().optional(),
  weight: z.number().positive().optional(),
  injectionSite: z.string().max(100).optional(),
  batchNumber: z.string().max(100).optional(),
  expiryDate: z.string().optional(),
  notes: z.string().max(5000).optional(),
  administeredById: z.string().uuid().optional(),
});
export type CreateLaiValidationDTO = z.infer<typeof CreateLaiValidationSchema>;
