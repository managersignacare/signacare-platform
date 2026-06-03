// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ScribeConsentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  sessionId: z.string().max(128).nullable().optional(),
  mode: z.string(),
  patientSignaturePng: z.string().nullable().optional(),
  clinicianAttestedById: z.string().uuid().nullable().optional(),
  clinicianAttestationText: z.string().nullable().optional(),
  attestedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
  revokedBy: z.string().uuid().nullable().optional(),
  revokeReason: z.string().nullable().optional(),
});

export type ScribeConsentsResponseScaffold = z.infer<typeof ScribeConsentsResponseScaffoldSchema>;
