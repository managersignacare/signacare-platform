// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicalFormulationsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  authorId: z.string().uuid().nullable().optional(),
  formulationType: z.string().max(50),
  presentingProblem: z.string().nullable().optional(),
  predisposingFactors: z.string().nullable().optional(),
  precipitatingFactors: z.string().nullable().optional(),
  perpetuatingFactors: z.string().nullable().optional(),
  protectiveFactors: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  diagnosticFormulation: z.string().nullable().optional(),
  treatmentImplications: z.string().nullable().optional(),
  sharedWithPatient: z.boolean(),
  status: z.string().max(30),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  sharedWithClinicians: z.boolean(),
  confidentialityLevel: z.string(),
});

export type ClinicalFormulationsDtoScaffold = z.infer<typeof ClinicalFormulationsDtoScaffoldSchema>;
