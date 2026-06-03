import { z } from 'zod';

export const LetterCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  clinicalNoteId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  recipientProviderId: z.string().uuid().optional(),
  recipientName: z.string().min(1),
  recipientEmail: z.string().email().optional(),
  recipientFax: z.string().optional(),
  letterType: z.string(),
  subject: z.string(),
  body: z.string(),
  notes: z.string().optional(),
  status: z.enum(['draft', 'sent', 'cancelled']).optional(),
});
export type LetterCreateDTO = z.infer<typeof LetterCreateSchema>;

export const LetterUpdateSchema = LetterCreateSchema.partial().extend({
  status: z.enum(['draft', 'sent', 'cancelled']).optional(),
  sentVia: z.string().optional(),
});
export type LetterUpdateDTO = z.infer<typeof LetterUpdateSchema>;

export const GenerateLetterFromNoteSchema = z.object({
  clinicalNoteId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  recipientProviderIds: z.array(z.string().uuid()),
  templateId: z.string().uuid().optional(),
  letterType: z.string().optional(),
  includeAssessment: z.boolean().optional(),
  includePlan: z.boolean().optional(),
  includeMedications: z.boolean().optional(),
  customNotes: z.string().optional(),
});
export type GenerateLetterFromNoteDTO = z.infer<typeof GenerateLetterFromNoteSchema>;

export interface LetterResponse {
  id: string;
  clinicId: string;
  patientId: string;
  episodeId: string | null;
  clinicalNoteId: string | null;
  templateId: string | null;
  recipientProviderId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  recipientFax: string | null;
  letterType: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent' | 'cancelled';
  sentAt: string | null;
  sentVia: string | null;
  notes: string | null;
  generatedById: string;
  /** Derived from the letter's linked episode — used by the frontend
   *  SpecialtyFilterChips on the Correspondence tab. Null when the
   *  letter isn't tied to an episode, or when the episode predates
   *  the Phase 0 specialty_code backfill. */
  specialtyCode: string | null;
  createdAt: string;
  updatedAt: string;
}
