// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientAppAccountsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  passwordHash: z.string().max(255),
  isActive: z.boolean(),
  mfaEnabled: z.boolean(),
  mfaSecret: z.string().max(64).nullable().optional(),
  lastLoginAt: z.string().datetime().nullable().optional(),
  failedLoginAttempts: z.number().int(),
  lockedUntil: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientAppAccountsDtoScaffold = z.infer<typeof PatientAppAccountsDtoScaffoldSchema>;
