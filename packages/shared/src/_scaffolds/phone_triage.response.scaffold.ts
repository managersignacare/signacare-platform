// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PhoneTriageResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  callerName: z.string().max(200),
  callerRelationship: z.string().max(100).nullable().optional(),
  callerPhone: z.string().max(30).nullable().optional(),
  reasonForCall: z.string(),
  urgency: z.string().max(30),
  triageNotes: z.string().nullable().optional(),
  actionTaken: z.string().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  receivedById: z.string().uuid().nullable().optional(),
  triagedByStaffId: z.string().uuid().nullable().optional(),
  status: z.string().max(30),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  receptionistSummary: z.string().nullable().optional(),
  clinicalRiskFlags: z.unknown().nullable().optional(),
  lockVersion: z.number().int(),
});

export type PhoneTriageResponseScaffold = z.infer<typeof PhoneTriageResponseScaffoldSchema>;
