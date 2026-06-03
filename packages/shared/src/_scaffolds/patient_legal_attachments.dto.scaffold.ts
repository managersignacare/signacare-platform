// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientLegalAttachmentsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  legalOrderId: z.string().uuid().nullable().optional(),
  category: z.string().max(50),
  filename: z.string().max(500),
  mimeType: z.string().max(100).nullable().optional(),
  fileSize: z.number().int().nullable().optional(),
  filePath: z.string(),
  createdAt: z.string().datetime(),
  storageBackend: z.string(),
  storageKey: z.string().nullable().optional(),
  storageBucket: z.string().nullable().optional(),
  storageEtag: z.string().nullable().optional(),
  clinicId: z.string().uuid(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type PatientLegalAttachmentsDtoScaffold = z.infer<typeof PatientLegalAttachmentsDtoScaffoldSchema>;
