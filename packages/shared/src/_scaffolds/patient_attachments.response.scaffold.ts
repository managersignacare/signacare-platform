// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientAttachmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  uploadedBy: z.string().uuid().nullable().optional(),
  filename: z.string().max(500),
  label: z.string().max(300).nullable().optional(),
  mimeType: z.string().max(100).nullable().optional(),
  fileSize: z.number().int().nullable().optional(),
  filePath: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  storageBackend: z.string(),
  storageKey: z.string().nullable().optional(),
  storageBucket: z.string().nullable().optional(),
  storageEtag: z.string().nullable().optional(),
  clinicId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  specialtyCode: z.string().max(40).nullable().optional(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type PatientAttachmentsResponseScaffold = z.infer<typeof PatientAttachmentsResponseScaffoldSchema>;
