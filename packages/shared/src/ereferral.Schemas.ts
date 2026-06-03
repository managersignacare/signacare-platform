import { z } from 'zod';

export const CreateEreferralSchema = z.object({
  patientId: z.string().uuid(),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  reason: z.string().min(1).max(5000),
  clinicalSummary: z.string().max(10000).optional(),
  diagnosis: z.string().max(2000).optional(),
  currentMedications: z.string().max(5000).optional(),
  riskSummary: z.string().max(5000).optional(),
});
export type CreateEreferralDTO = z.infer<typeof CreateEreferralSchema>;

export const UpdateEreferralSchema = z.object({
  status: z.string().max(50).optional(),
  responseNotes: z.string().max(5000).optional(),
});
export type UpdateEreferralDTO = z.infer<typeof UpdateEreferralSchema>;
