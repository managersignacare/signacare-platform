// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ChecklistTemplatesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(200),
  description: z.string().nullable().optional(),
  triggerPoint: z.string().max(50),
  enforcement: z.string().max(20),
  items: z.unknown(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ChecklistTemplatesDtoScaffold = z.infer<typeof ChecklistTemplatesDtoScaffoldSchema>;
