// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicSettingsDtoScaffoldSchema = z.object({
  clinicId: z.string().uuid(),
  scribeConsentMode: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  aiChatClassifierMode: z.string(),
  scribeAudioRetention: z.string(),
  sharepointSiteId: z.string().max(255).nullable().optional(),
  letterheadHtml: z.string().nullable().optional(),
  letterheadLogoUrl: z.string().max(500).nullable().optional(),
  defaultLetterLanguage: z.string().max(5),
  defaultGuidelines: z.unknown().nullable().optional(),
  trainingOptIn: z.boolean(),
  trainingOptInChangedBy: z.string().max(100).nullable().optional(),
  trainingOptInChangedAt: z.string().datetime().nullable().optional(),
  emailSenderMode: z.string(),
  clinicSenderEmail: z.string().max(255).nullable().optional(),
  clinicSenderName: z.string().max(120).nullable().optional(),
  scribeAudioRetentionAdr: z.string().nullable().optional(),
  scribeAudioRetentionClinicalReview: z.string().nullable().optional(),
  scribeAudioRetentionApprovedByStaffId: z.string().uuid().nullable().optional(),
  scribeAudioRetentionApprovedAt: z.string().datetime().nullable().optional(),
  aiLlmBackend: z.string().max(40),
  scribeRuntimeMode: z.string().max(40),
  localStyleAdapterModelName: z.string().max(200).nullable().optional(),
});

export type ClinicSettingsDtoScaffold = z.infer<typeof ClinicSettingsDtoScaffoldSchema>;
