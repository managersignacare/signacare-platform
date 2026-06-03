// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicalNotesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  authorId: z.string().uuid().nullable().optional(),
  appointmentId: z.string().uuid().nullable().optional(),
  title: z.string().max(500).nullable().optional(),
  noteType: z.string().max(50),
  noteCategory: z.string().max(100).nullable().optional(),
  sourceType: z.string().max(50).nullable().optional(),
  noteDateTime: z.string().datetime().nullable().optional(),
  noteDate: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  contentHtml: z.string().nullable().optional(),
  structuredFields: z.unknown().nullable().optional(),
  status: z.string().max(30),
  isDraft: z.boolean().nullable().optional(),
  isSigned: z.boolean().nullable().optional(),
  templateId: z.string().uuid().nullable().optional(),
  isReportableContact: z.boolean(),
  contactMeta: z.unknown().nullable().optional(),
  foiContent: z.string().nullable().optional(),
  foiExempt: z.boolean(),
  didNotAttend: z.boolean(),
  isAiDraft: z.boolean(),
  soapSubjective: z.string().nullable().optional(),
  soapObjective: z.string().nullable().optional(),
  soapAssessment: z.string().nullable().optional(),
  soapPlan: z.string().nullable().optional(),
  amendedFromId: z.string().uuid().nullable().optional(),
  signedAt: z.string().datetime().nullable().optional(),
  signedBy: z.string().uuid().nullable().optional(),
  signedById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
  reviewedAndAdoptedById: z.string().uuid().nullable().optional(),
  reviewedAndAdoptedAt: z.string().datetime().nullable().optional(),
  consentId: z.string().uuid().nullable().optional(),
});

export type ClinicalNotesResponseScaffold = z.infer<typeof ClinicalNotesResponseScaffoldSchema>;
