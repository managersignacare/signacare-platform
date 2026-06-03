// Phase 0.7 PR3 Class D — NoteType / NoteStatus / CreateNoteDTO /
// UpdateNoteDTO now imported from shared (single source of truth).
// The local NoteTypeEnum was an 8-value subset of the shared 14-value
// NoteType — backend could emit consultation/progress_note/assessment/
// discharge_summary/other/mse and the frontend would have no matching
// switch case. The local NoteStatusEnum added a third 'amended' value
// the backend never emits.
import { z } from 'zod';
import {
  NoteTypeSchema,
  NoteStatusSchema,
  CreateNoteSchema as SharedCreateNoteSchema,
  UpdateNoteSchema as SharedUpdateNoteSchema,
} from '@signacare/shared';
import type {
  NoteType,
  NoteStatus,
} from '@signacare/shared';
export type {
  NoteType,
  NoteStatus,
  CreateNoteDTO,
  UpdateNoteDTO,
} from '@signacare/shared';
// Re-export under the local *Enum names that existing components import.
export const NoteTypeEnum = NoteTypeSchema;
export const NoteStatusEnum = NoteStatusSchema;

export const SoapContentSchema = z.object({
  subjective: z.string().default(''),
  objective:  z.string().default(''),
  assessment: z.string().default(''),
  plan:       z.string().default(''),
});
export type SoapContent = z.infer<typeof SoapContentSchema>;

// Phase 0.7 PR3 Class D — CreateNoteSchema / UpdateNoteSchema imported
// from shared above. Re-exported below under their historical names so
// existing form components (NoteForm, AddNoteDialog) keep compiling.
export const CreateNoteSchema = SharedCreateNoteSchema;
export const UpdateNoteSchema = SharedUpdateNoteSchema;

export interface NoteResponse {
  id:             string;
  clinicId:       string;
  patientId:      string;
  episodeId:      string | null;
  authorId:       string;
  authorName:     string;
  noteType:       NoteType;
  status:         NoteStatus;
  noteDateTime:   string;
  content:        string;
  soapSubjective: string | null;
  soapObjective:  string | null;
  soapAssessment: string | null;
  soapPlan:       string | null;
  templateId:     string | null;
  isAiDraft:      boolean;
  amendedFromId:  string | null;
  signedAt:       string | null;
  signedById:     string | null;
  createdAt:      string;
  updatedAt:      string;
}
