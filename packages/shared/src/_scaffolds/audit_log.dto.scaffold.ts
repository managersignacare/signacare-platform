// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AuditLogDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  username: z.string().max(200).nullable().optional(),
  action: z.string().max(50).nullable().optional(),
  operation: z.string().max(50).nullable().optional(),
  module: z.string().max(100).nullable().optional(),
  entityType: z.string().max(100).nullable().optional(),
  entityId: z.string().max(100).nullable().optional(),
  tableName: z.string().max(100).nullable().optional(),
  recordId: z.string().max(100).nullable().optional(),
  details: z.unknown().nullable().optional(),
  oldData: z.unknown().nullable().optional(),
  newData: z.unknown().nullable().optional(),
  ipAddress: z.string().max(50).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
  createdAt: z.string().datetime(),
  dedupeKey: z.string().max(255).nullable().optional(),
  prevHash: z.string().max(64),
  rowHash: z.string().max(64),
  chainOrdinal: z.number().int(),
});

export type AuditLogDtoScaffold = z.infer<typeof AuditLogDtoScaffoldSchema>;
