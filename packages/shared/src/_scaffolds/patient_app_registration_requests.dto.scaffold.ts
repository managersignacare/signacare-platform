// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientAppRegistrationRequestsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  dedupeKey: z.string().max(128),
  givenName: z.string().max(512),
  familyName: z.string().max(512),
  preferredName: z.string().max(512).nullable().optional(),
  dateOfBirth: z.string().max(512),
  gender: z.string().max(512).nullable().optional(),
  phoneMobile: z.string().max(512),
  email: z.string().max(512).nullable().optional(),
  address: z.unknown(),
  nextOfKin: z.unknown(),
  gp: z.unknown(),
  supportPerson: z.unknown(),
  reason: z.string().nullable().optional(),
  source: z.string().max(60),
  status: z.string().max(30),
  reviewedByStaffId: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  duplicatePatientId: z.string().uuid().nullable().optional(),
  clientRequestId: z.string().max(128).nullable().optional(),
  metadata: z.unknown(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type PatientAppRegistrationRequestsDtoScaffold = z.infer<typeof PatientAppRegistrationRequestsDtoScaffoldSchema>;
