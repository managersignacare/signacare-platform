// packages/shared/src/schemas/pathology.schemas.ts
import { z } from 'zod';

export const PathologyOrderCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  appointmentId: z.string().uuid().optional(),
  panelName: z.string().min(1).max(255),
  tests: z.array(z.string().min(1)).min(1),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  clinicalNotes: z.string().optional(),
  fasting: z.boolean().default(false),
  copyToGp: z.boolean().default(false),
});
export type PathologyOrderCreateDTO = z.infer<typeof PathologyOrderCreateSchema>;

export const PathologyOrderResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  appointmentId: z.string().uuid().nullable(),
  orderedById: z.string().uuid(),
  orderNumber: z.string(),
  panelName: z.string(),
  tests: z.array(z.string()),
  urgency: z.enum(['routine', 'urgent', 'stat']),
  clinicalNotes: z.string().nullable(),
  fasting: z.boolean(),
  copyToGp: z.boolean(),
  status: z.enum(['pending', 'sent', 'partial', 'complete', 'cancelled']),
  hl7SentAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PathologyOrderResponse = z.infer<typeof PathologyOrderResponseSchema>;

export const PathologyResultIngestSchema = z.object({
  pathologyOrderId: z.string().uuid(),
  testCode: z.string().min(1).max(50),
  testName: z.string().min(1).max(255),
  resultValue: z.string().min(1).max(500),
  resultUnit: z.string().max(50).optional(),
  referenceRange: z.string().max(100).optional(),
  abnormalFlag: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal'])
    .default('normal'),
  resultStatus: z.enum(['preliminary', 'final', 'corrected', 'cancelled']).default('final'),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resultDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  performingLab: z.string().max(255).optional(),
  hl7Raw: z.string().optional(),
});
export type PathologyResultIngestDTO = z.infer<typeof PathologyResultIngestSchema>;

export const PathologyResultResponseSchema = PathologyResultIngestSchema.extend({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  isCritical: z.boolean(),
  criticalAcknowledgedAt: z.string().datetime().nullable(),
  criticalAcknowledgedById: z.string().uuid().nullable(),
  flagTaskId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PathologyResultResponse = z.infer<typeof PathologyResultResponseSchema>;

export const CriticalAckSchema = z.object({
  notes: z.string().optional(),
});
export type CriticalAckDTO = z.infer<typeof CriticalAckSchema>;

