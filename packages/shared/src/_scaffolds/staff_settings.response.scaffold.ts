// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const StaffSettingsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  staffId: z.string().uuid(),
  settingKey: z.string().max(200),
  settingValue: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type StaffSettingsResponseScaffold = z.infer<typeof StaffSettingsResponseScaffoldSchema>;
