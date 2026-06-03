// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AdmissionWaitlistResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  hotspotId: z.string().uuid().nullable().optional(),
  source: z.string().max(30),
  priority: z.string().max(20),
  status: z.string().max(30),
  reason: z.string().nullable().optional(),
  clinicalNotes: z.string().nullable().optional(),
  preferredWard: z.string().max(100).nullable().optional(),
  targetAdmissionDate: z.string().nullable().optional(),
  flaggedByStaffId: z.string().uuid().nullable().optional(),
  removedByStaffId: z.string().uuid().nullable().optional(),
  removedAt: z.string().datetime().nullable().optional(),
  removalReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AdmissionWaitlistResponseScaffold = z.infer<typeof AdmissionWaitlistResponseScaffoldSchema>;
