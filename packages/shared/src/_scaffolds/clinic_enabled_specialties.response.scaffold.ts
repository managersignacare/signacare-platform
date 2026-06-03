// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ClinicEnabledSpecialtiesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  specialtyCode: z.string().max(40),
  enabledAt: z.string().datetime(),
  enabledBy: z.string().uuid().nullable().optional(),
});

export type ClinicEnabledSpecialtiesResponseScaffold = z.infer<typeof ClinicEnabledSpecialtiesResponseScaffoldSchema>;
