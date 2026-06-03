// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientSharedDocumentsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  title: z.string().max(255),
  docType: z.string().max(30),
  filePath: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  sharedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type PatientSharedDocumentsDtoScaffold = z.infer<typeof PatientSharedDocumentsDtoScaffoldSchema>;
