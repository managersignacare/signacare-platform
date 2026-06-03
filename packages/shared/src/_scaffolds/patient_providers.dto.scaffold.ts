// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientProvidersDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  providerType: z.string().max(50).nullable().optional(),
  providerName: z.string().max(200).nullable().optional(),
  providerPractice: z.string().max(200).nullable().optional(),
  providerPhone: z.string().max(30).nullable().optional(),
  providerFax: z.string().max(30).nullable().optional(),
  providerEmail: z.string().max(255).nullable().optional(),
  providerNumber: z.string().max(30).nullable().optional(),
  providerAddress: z.string().nullable().optional(),
  isPrimary: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type PatientProvidersDtoScaffold = z.infer<typeof PatientProvidersDtoScaffoldSchema>;
