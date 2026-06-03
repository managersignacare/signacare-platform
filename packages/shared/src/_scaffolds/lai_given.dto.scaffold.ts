// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const LaiGivenDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  laiScheduleId: z.string().uuid(),
  patientId: z.string().uuid(),
  administeredByStaffId: z.string().uuid(),
  scheduleId: z.string().uuid().nullable().optional(),
  administeredById: z.string().uuid().nullable().optional(),
  outcome: z.string().max(30),
  givenDate: z.string(),
  doseGivenMg: z.string().max(50).nullable().optional(),
  doseGiven: z.string().max(50).nullable().optional(),
  injectionSite: z.string().max(50).nullable().optional(),
  batchNumber: z.string().max(100).nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  refusalReason: z.string().max(300).nullable().optional(),
  deferredToDate: z.string().nullable().optional(),
  nextDueDate: z.string().nullable().optional(),
  aimsDue: z.boolean().nullable().optional(),
  aimsCompleted: z.boolean().nullable().optional(),
  aimsResponseId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type LaiGivenDtoScaffold = z.infer<typeof LaiGivenDtoScaffoldSchema>;
