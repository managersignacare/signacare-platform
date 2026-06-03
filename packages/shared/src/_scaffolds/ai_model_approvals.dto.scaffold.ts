// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AiModelApprovalsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  modelName: z.string().max(200),
  modelDigest: z.string().max(100),
  approvedByStaffId: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type AiModelApprovalsDtoScaffold = z.infer<typeof AiModelApprovalsDtoScaffoldSchema>;
