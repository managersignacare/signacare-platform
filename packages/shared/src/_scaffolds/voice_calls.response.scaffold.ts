// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const VoiceCallsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  scriptId: z.string().uuid().nullable().optional(),
  initiatedById: z.string().uuid().nullable().optional(),
  direction: z.string().max(20),
  status: z.string().max(30),
  phoneNumberMasked: z.string().max(30).nullable().optional(),
  durationSeconds: z.number().int().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  callSid: z.string().max(100).nullable().optional(),
  transcriptAvailable: z.boolean(),
  transcriptS3Key: z.string().max(500).nullable().optional(),
  outcome: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type VoiceCallsResponseScaffold = z.infer<typeof VoiceCallsResponseScaffoldSchema>;
