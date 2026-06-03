import { z } from 'zod';

export const NoteTypeSchema = z.enum([
  'consultation',
  'progress_note',
  'assessment',
  'discharge_summary',
  'correspondence',
  'other',
  'soap',
  'intake',
  'progress',
  'discharge',
  'mdt',
  'mse',
  'risk',
  'amended',
]);
export type NoteType = z.infer<typeof NoteTypeSchema>;

export const NoteStatusSchema = z.enum(['draft', 'signed']);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;

export const CreateNoteSchema = z.object({
  patientId:      z.string().uuid(),
  consentId:      z.string().uuid().optional(),
  episodeId:      z.string().uuid().optional(),
  appointmentId:  z.string().uuid().optional(),
  noteType:       NoteTypeSchema,
  noteDateTime:   z.string().datetime(),
  content:        z.string().min(1, 'Content is required'),
  soapSubjective: z.string().optional(),
  soapObjective:  z.string().optional(),
  soapAssessment: z.string().optional(),
  soapPlan:       z.string().optional(),
  templateId:     z.string().uuid().optional(),
  isAiDraft:      z.boolean().default(false),
  amendedFromId:  z.string().uuid().optional(),
});
export type CreateNoteDTO = z.infer<typeof CreateNoteSchema>;

export const UpdateNoteSchema = z.object({
  noteType:       NoteTypeSchema.optional(),
  noteDateTime:   z.string().datetime().optional(),
  content:        z.string().min(1).optional(),
  soapSubjective: z.string().optional(),
  soapObjective:  z.string().optional(),
  soapAssessment: z.string().optional(),
  soapPlan:       z.string().optional(),
  templateId:     z.string().uuid().optional(),
  isAiDraft:      z.boolean().optional(),
});
export type UpdateNoteDTO = z.infer<typeof UpdateNoteSchema>;

export const SignNoteSchema = z.object({
  reviewedAndAdopted: z.boolean().optional().default(false),
});
export type SignNoteDTO = z.infer<typeof SignNoteSchema>;
