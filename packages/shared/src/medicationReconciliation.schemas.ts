// packages/shared/src/medicationReconciliation.schemas.ts
//
// Multi-specialty Phase 3 — Internal Medicine: medication reconciliation DTOs.
import { z } from 'zod';

export const MedRecContextEnum = z.enum([
  'admission',
  'discharge',
  'transfer',
  'outpatient',
  'periodic-review',
]);
export type MedRecContext = z.infer<typeof MedRecContextEnum>;

export const MedRecDispositionEnum = z.enum([
  'continued',
  'ceased',
  'modified',
  'new',
  'on-hold',
]);
export type MedRecDisposition = z.infer<typeof MedRecDispositionEnum>;

export const MedRecSnapshotItemSchema = z.object({
  medicationId: z.string().uuid().nullable().optional(),
  drugLabel: z.string().min(1).max(300),
  dose: z.string().max(100).nullable().optional(),
  frequency: z.string().max(100).nullable().optional(),
  disposition: MedRecDispositionEnum,
  notes: z.string().max(500).nullable().optional(),
});
export type MedRecSnapshotItem = z.infer<typeof MedRecSnapshotItemSchema>;

export const CreateMedRecSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  context: MedRecContextEnum,
  snapshot: z.array(MedRecSnapshotItemSchema),
  summaryNotes: z.string().max(4000).nullable().optional(),
});
export type CreateMedRecDTO = z.infer<typeof CreateMedRecSchema>;

export const MedRecResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  context: MedRecContextEnum,
  performedAt: z.string(),
  performedBy: z.string().uuid().nullable(),
  performedByName: z.string().nullable().optional(),
  snapshot: z.array(MedRecSnapshotItemSchema),
  continuedCount: z.number().int(),
  ceasedCount: z.number().int(),
  modifiedCount: z.number().int(),
  newCount: z.number().int(),
  onHoldCount: z.number().int(),
  summaryNotes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MedRecResponse = z.infer<typeof MedRecResponseSchema>;
