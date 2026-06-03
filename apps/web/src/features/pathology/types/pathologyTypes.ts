// apps/web/src/features/pathology/types/pathologyTypes.ts
// Schemas mirror @signacare/shared — move there and re-import in production.
import { z } from 'zod';

export const LabOrderStatusSchema = z.enum([
  'pending',
  'collected',
  'in_transit',
  'resulted',
  'partial',
  'cancelled',
]);
export type LabOrderStatus = z.infer<typeof LabOrderStatusSchema>;

export const LabTestSchema = z.object({
  testCode: z.string().min(1).max(50),
  testName: z.string().min(1).max(200),
  notes: z.string().optional(),
});
export type LabTest = z.infer<typeof LabTestSchema>;

export const CreateLabOrderSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  requestingStaffId: z.string().uuid().optional(),
  labProvider: z.string().max(200).optional(),
  specimenType: z.string().max(100).optional(),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  clinicalNotes: z.string().optional(),
  fasting: z.boolean().default(false),
  tests: z.array(LabTestSchema).min(1),
});
export type CreateLabOrderDTO = z.infer<typeof CreateLabOrderSchema>;

export const LabOrderResponseSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  orderNumber: z.string(),
  labProvider: z.string().nullable(),
  specimenType: z.string().nullable(),
  urgency: z.string(),
  status: LabOrderStatusSchema,
  collectionDate: z.string().nullable(),
  fasting: z.boolean(),
  clinicalNotes: z.string().nullable(),
  requestingStaffName: z.string().nullable(),
  tests: z.array(
    z.object({
      testCode: z.string(),
      testName: z.string(),
      notes: z.string().nullable(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LabOrderResponse = z.infer<typeof LabOrderResponseSchema>;

export const LabResultValueSchema = z.object({
  testCode: z.string(),
  testName: z.string(),
  value: z.string().nullable(),
  unit: z.string().nullable(),
  referenceRange: z.string().nullable(),
  status: z.enum([
    'normal',
    'abnormal_low',
    'abnormal_high',
    'critical_low',
    'critical_high',
    'unknown',
  ]),
  notes: z.string().nullable(),
});
export type LabResultValue = z.infer<typeof LabResultValueSchema>;

export const LabResultResponseSchema = z.object({
  id: z.string().uuid(),
  labOrderId: z.string().uuid(),
  patientId: z.string().uuid(),
  orderNumber: z.string(),
  collectionDate: z.string().nullable(),
  reportedDate: z.string().nullable(),
  labProvider: z.string().nullable(),
  isCritical: z.boolean(),
  criticalAcknowledgedAt: z.string().nullable(),
  criticalAcknowledgedByStaffName: z.string().nullable(),
  results: z.array(LabResultValueSchema),
  rawHl7: z.string().nullable(),
  createdAt: z.string(),
});
export type LabResultResponse = z.infer<typeof LabResultResponseSchema>;
