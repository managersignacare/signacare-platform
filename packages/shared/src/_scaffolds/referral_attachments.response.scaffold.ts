// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const ReferralAttachmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  originalFilename: z.string().max(500),
  storedFilename: z.string().max(500),
  mimeType: z.string().max(100),
  fileSizeBytes: z.number().int(),
  storageKey: z.string().max(500),
  category: z.string().max(50),
  ocrStatus: z.string().max(30),
  ocrResult: z.unknown().nullable().optional(),
  ocrErrorMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type ReferralAttachmentsResponseScaffold = z.infer<typeof ReferralAttachmentsResponseScaffoldSchema>;
