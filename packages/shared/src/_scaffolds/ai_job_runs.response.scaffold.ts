// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const AiJobRunsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  consentId: z.string().uuid().nullable().optional(),
  action: z.string().max(100),
  status: z.string().max(40),
  progressPercent: z.number().int(),
  stage: z.string().max(80).nullable().optional(),
  statusMessage: z.string().nullable().optional(),
  model: z.string().max(200).nullable().optional(),
  inputSummary: z.string().nullable().optional(),
  queuePayload: z.unknown(),
  resultText: z.string().nullable().optional(),
  resultJson: z.unknown(),
  outputHash: z.string().max(128).nullable().optional(),
  validationValid: z.boolean().nullable().optional(),
  errorCode: z.string().max(120).nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  validationWarnings: z.unknown(),
  audioStorageKey: z.string().max(1024).nullable().optional(),
  audioStorageBackend: z.string().max(40).nullable().optional(),
  audioStorageBucket: z.string().max(255).nullable().optional(),
  audioMimeType: z.string().max(120).nullable().optional(),
  audioRetentionPolicy: z.string().max(40).nullable().optional(),
  audioDeletedAt: z.string().datetime().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  failedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type AiJobRunsResponseScaffold = z.infer<typeof AiJobRunsResponseScaffoldSchema>;
