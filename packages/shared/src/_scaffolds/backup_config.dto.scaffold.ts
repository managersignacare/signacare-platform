// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const BackupConfigDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  scheduleEnabled: z.boolean(),
  frequency: z.string().max(16),
  timeOfDay: z.string().max(5),
  retentionDays: z.number().int(),
  localDir: z.string().nullable().optional(),
  offsiteTarget: z.string().nullable().optional(),
  lastRunAt: z.string().datetime().nullable().optional(),
  lastRunStatus: z.string().max(16).nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type BackupConfigDtoScaffold = z.infer<typeof BackupConfigDtoScaffoldSchema>;
