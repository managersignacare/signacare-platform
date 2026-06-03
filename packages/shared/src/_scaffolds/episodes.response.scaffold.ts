// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const EpisodesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  title: z.string().max(300).nullable().optional(),
  episodeNumber: z.string().max(50).nullable().optional(),
  episodeType: z.string().max(50).nullable().optional(),
  status: z.string().max(30),
  presentingProblem: z.string().nullable().optional(),
  primaryDiagnosis: z.string().nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  closureReason: z.string().nullable().optional(),
  closureSummary: z.string().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  primaryClinicianId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  dischargeSignatureData: z.string().nullable().optional(),
  dischargeSignedById: z.string().uuid().nullable().optional(),
  dischargeSignedAt: z.string().datetime().nullable().optional(),
  keyWorkerId: z.string().uuid().nullable().optional(),
  specialtyCode: z.string().max(40),
  dischargeSummaryContent: z.string().nullable().optional(),
  dischargeVettingStatus: z.string().max(40).nullable().optional(),
  dischargeVettedById: z.string().uuid().nullable().optional(),
  dischargeVettedAt: z.string().datetime().nullable().optional(),
  dischargeSignature: z.string().nullable().optional(),
  closureVettingStatus: z.string().max(40).nullable().optional(),
  closureVettedById: z.string().uuid().nullable().optional(),
  closureVettedAt: z.string().datetime().nullable().optional(),
  closureSignature: z.string().nullable().optional(),
  lockVersion: z.number().int(),
});

export type EpisodesResponseScaffold = z.infer<typeof EpisodesResponseScaffoldSchema>;
