import { z } from 'zod';

export const PatientFlagResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  category: z.string(),
  severity: z.enum([
    'info',
    'low',
    'medium',
    'high',
    'urgent',
    'critical',
  ]),
  message: z.string(),
  isActive: z.boolean(),
  showInSummary: z.boolean(),
  acknowledged: z.boolean(),
  acknowledgedByStaffId: z.string().uuid().nullable(),
  acknowledgedAt: z.string().datetime().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  raisedByStaffId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});

export type PatientFlagResponse = z.infer<
  typeof PatientFlagResponseSchema
>;
