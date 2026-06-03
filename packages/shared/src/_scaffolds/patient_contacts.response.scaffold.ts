// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientContactsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  givenName: z.string().max(100),
  familyName: z.string().max(100).nullable().optional(),
  relationship: z.string().max(100).nullable().optional(),
  phoneMobile: z.string().max(30).nullable().optional(),
  phoneHome: z.string().max(30).nullable().optional(),
  email: z.string().max(255).nullable().optional(),
  isEmergencyContact: z.boolean(),
  isCarer: z.boolean(),
  hasConsent: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  contactType: z.string().max(50).nullable().optional(),
  consentLevel: z.string().max(50).nullable().optional(),
  consentNotes: z.string().nullable().optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  clinicId: z.string().uuid(),
});

export type PatientContactsResponseScaffold = z.infer<typeof PatientContactsResponseScaffoldSchema>;
