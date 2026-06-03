// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicContactOptionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  locations: z.unknown().nullable().optional(),
  programs: z.unknown().nullable().optional(),
  serviceRecipientTypes: z.unknown().nullable().optional(),
  contactMediaTypes: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicContactOptionsDtoScaffold = z.infer<typeof ClinicContactOptionsDtoScaffoldSchema>;
