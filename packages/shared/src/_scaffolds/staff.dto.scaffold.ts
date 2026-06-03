// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const StaffDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  givenName: z.string().max(100),
  familyName: z.string().max(100),
  preferredName: z.string().max(100).nullable().optional(),
  email: z.string().max(255),
  passwordHash: z.string().max(255),
  role: z.string().max(50),
  discipline: z.string().max(100).nullable().optional(),
  disciplineId: z.string().max(100).nullable().optional(),
  phoneMobile: z.string().max(30).nullable().optional(),
  phoneWork: z.string().max(30).nullable().optional(),
  ahpraNumber: z.string().max(50).nullable().optional(),
  prescriberNumber: z.string().max(50).nullable().optional(),
  providerNumber: z.string().max(50).nullable().optional(),
  hpii: z.string().max(50).nullable().optional(),
  qualifications: z.string().nullable().optional(),
  specialisation: z.string().max(200).nullable().optional(),
  employmentType: z.string().max(50).nullable().optional(),
  workerType: z.string().max(50).nullable().optional(),
  isActive: z.boolean(),
  requireMfa: z.boolean(),
  hasMfaConfigured: z.boolean(),
  mfaEnabled: z.boolean().nullable().optional(),
  mfaSecret: z.string().max(255).nullable().optional(),
  recoveryCodes: z.unknown().nullable().optional(),
  mustChangePassword: z.boolean().nullable().optional(),
  failedLoginAttempts: z.number().int(),
  lockedUntil: z.string().datetime().nullable().optional(),
  lastLoginAt: z.string().datetime().nullable().optional(),
  outlookEmail: z.string().max(255).nullable().optional(),
  outlookRefreshToken: z.string().max(1000).nullable().optional(),
  outlookTokenExpiresAt: z.number().int().nullable().optional(),
  outlookCalendarId: z.string().max(255).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  digitalSignature: z.string().nullable().optional(),
  maxConcurrentSessions: z.number().int(),
});

export type StaffDtoScaffold = z.infer<typeof StaffDtoScaffoldSchema>;
