// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AiContextFilesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  title: z.string().max(200),
  description: z.string().nullable().optional(),
  category: z.string().max(50),
  content: z.string(),
  contentFormat: z.string().max(20),
  isActive: z.boolean(),
  includeInRag: z.boolean(),
  priority: z.number().int(),
  tokenEstimate: z.number().int().nullable().optional(),
  uploadedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AiContextFilesResponseScaffold = z.infer<typeof AiContextFilesResponseScaffoldSchema>;
