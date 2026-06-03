// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const VoicePatientPreferencesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  optedOut: z.boolean(),
  optedOutAt: z.string().datetime().nullable().optional(),
  optOutChannel: z.string().max(30).nullable().optional(),
  preferredCallStart: z.string().max(10).nullable().optional(),
  preferredCallEnd: z.string().max(10).nullable().optional(),
  preferredCallTime: z.string().max(10).nullable().optional(),
  preferredDays: z.unknown().nullable().optional(),
  preferredCallDays: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type VoicePatientPreferencesResponseScaffold = z.infer<typeof VoicePatientPreferencesResponseScaffoldSchema>;
