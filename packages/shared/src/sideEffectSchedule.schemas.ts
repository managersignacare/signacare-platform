// packages/shared/src/sideEffectSchedule.schemas.ts
//
// BUG-613 — canonical Zod schemas for the `side_effect_schedules`
// surface (AIMS / metabolic / extrapyramidal / clozapine FBC monitoring
// schedule rows). Pre-fix the GET / POST / PUT `/side-effect-schedules`
// endpoints returned raw Knex rows (snake_case); the frontend consumer
// (SideEffectsPanel.tsx) read both camelCase + snake_case fields.
// Post-fix: backend mapper applies snake → camel + Zod-validates output;
// frontend consumes the canonical Response type.
//
// Sibling architectural class to BUG-618 (clozapine response-mapper
// consolidation) per CLAUDE.md §5.2.

import { z } from 'zod';

export const SideEffectScheduleTypeEnum = z.enum([
  'AIMS',
  'metabolic',
  'extrapyramidal',
  'clozapine_fbc',
  'lipid',
  'glucose',
  'weight',
  'other',
]);

export const SideEffectScheduleStatusEnum = z.enum([
  'active',
  'paused',
  'completed',
  'discontinued',
]);

// Create / update DTOs reflect the existing frontend payload shape
// at SideEffectsPanel scheduling forms (currently no UI write surface
// in production; reserved for future "Add monitoring schedule" dialog).
export const SideEffectScheduleCreateSchema = z.object({
  patientId: z.string().uuid(),
  prescriptionId: z.string().uuid().optional(),
  scheduleType: z.string().max(50),
  frequency: z.number().int().positive().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  parameters: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
});
export type SideEffectScheduleCreateDTO = z.infer<typeof SideEffectScheduleCreateSchema>;

export const SideEffectScheduleUpdateSchema = z.object({
  frequency: z.number().int().positive().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
  status: SideEffectScheduleStatusEnum.optional(),
  lastCompletedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type SideEffectScheduleUpdateDTO = z.infer<typeof SideEffectScheduleUpdateSchema>;

// Canonical Response shape: camelCase, NULLABLE where the DB column is
// nullable per schema-snapshot (`patient_medication_id`, `parameters`,
// `last_completed_date`, `notes`). The mapper at the backend boundary
// converts snake_case rows → this canonical shape before res.json().
export const SideEffectScheduleResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientMedicationId: z.string().uuid().nullable(),
  scheduleType: z.string(),
  frequencyWeeks: z.number(),
  nextDueDate: z.string().nullable(),
  lastCompletedDate: z.string().nullable(),
  parameters: z.record(z.string(), z.unknown()).nullable(),
  notes: z.string().nullable(),
  status: z.string(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SideEffectScheduleResponse = z.infer<typeof SideEffectScheduleResponseSchema>;
