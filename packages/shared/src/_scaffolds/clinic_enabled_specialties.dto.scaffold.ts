// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicEnabledSpecialtiesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  specialtyCode: z.string().max(40),
  enabledAt: z.string().datetime(),
  enabledBy: z.string().uuid().nullable().optional(),
});

export type ClinicEnabledSpecialtiesDtoScaffold = z.infer<typeof ClinicEnabledSpecialtiesDtoScaffoldSchema>;
