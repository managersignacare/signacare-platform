// Phase 0.7 PR3 Class D — LetterCreateDTO / LetterUpdateDTO /
// LetterResponse / GenerateLetterFromNoteDTO now imported from shared
// (single source of truth). The local LetterStatusSchema enum (4 values)
// drifted from shared (3 values: draft/sent/cancelled); local LETTER_TYPES
// const tuple remains because shared uses bare `letterType: z.string()`
// without enumeration — the LETTER_TYPES tuple is the frontend's source
// of dropdown options.
import { z } from 'zod';
import {
  LetterCreateSchema as SharedLetterCreateSchema,
  LetterUpdateSchema as SharedLetterUpdateSchema,
  GenerateLetterFromNoteSchema as SharedGenerateLetterFromNoteSchema,
} from '@signacare/shared';
export type {
  LetterCreateDTO,
  LetterUpdateDTO,
  LetterResponse,
  GenerateLetterFromNoteDTO,
} from '@signacare/shared';

export const LetterCreateSchema = SharedLetterCreateSchema;
export const LetterUpdateSchema = SharedLetterUpdateSchema;

export const LETTER_TYPES = [
  'discharge', 'referral_acceptance', 'referral_rejection', 'progress_update',
  'review_outcome', 'medication_change', 'appointment_confirmation',
  'appointment_cancellation', 'mha_notification', 'general',
] as const;
export type LetterType = typeof LETTER_TYPES[number];

// LetterStatus aligned to shared canonical 3-value enum.
export const LetterStatusSchema = z.enum(['draft', 'sent', 'cancelled']);
export type LetterStatus = z.infer<typeof LetterStatusSchema>;

export const LetterTemplateResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string(),
  letterType: z.string(),
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  defaultSalutation: z.string(),
  defaultClosing: z.string(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
});
export type LetterTemplateResponse = z.infer<typeof LetterTemplateResponseSchema>;

// Phase 0.7 PR3 Class D — GenerateLetterFromNoteSchema imported from
// shared above. Re-exported here under its historical name.
export const GenerateLetterFromNoteSchema = SharedGenerateLetterFromNoteSchema;
