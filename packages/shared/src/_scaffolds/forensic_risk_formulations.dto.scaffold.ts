// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ForensicRiskFormulationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  assessorId: z.string().uuid(),
  letterId: z.string().uuid().nullable().optional(),
  instrument: z.string().max(40),
  scores: z.unknown(),
  historicalSummary: z.string(),
  clinicalSummary: z.string(),
  riskManagementSummary: z.string(),
  overallRisk: z.string().max(20),
  overallReasoning: z.string(),
  assessedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ForensicRiskFormulationsDtoScaffold = z.infer<typeof ForensicRiskFormulationsDtoScaffoldSchema>;
