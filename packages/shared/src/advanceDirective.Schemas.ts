import { z } from 'zod';

export const CreateAdvanceDirectiveSchema = z.object({
  patientId: z.string().uuid(),
  type: z.string().min(1).max(100),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  status: z.enum(['active', 'revoked', 'expired', 'draft']).default('active'),
  content: z.record(z.unknown()).optional(),
  directiveType: z.string().max(100).optional(),
  documentDate: z.string().optional(),
  expiryDate: z.string().optional(),
  treatmentPreferences: z.string().max(5000).optional(),
  refusedTreatments: z.string().max(5000).optional(),
  nominatedPersonName: z.string().max(200).optional(),
  nominatedPersonRelationship: z.string().max(100).optional(),
  nominatedPersonPhone: z.string().max(30).optional(),
  nominatedPersonEmail: z.string().email().optional().or(z.literal('')),
  crisisInstructions: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateAdvanceDirectiveDTO = z.infer<typeof CreateAdvanceDirectiveSchema>;

export const UpdateAdvanceDirectiveSchema = CreateAdvanceDirectiveSchema
  .partial()
  .omit({ patientId: true })
  .extend({
    // BUG-565 — REQUIRED optimistic-lock version at update boundary.
    // R-FIX-BUG-565-ZOD-REQUIRED
    expectedLockVersion: z.number().int().positive(),
  });
export type UpdateAdvanceDirectiveDTO = z.infer<typeof UpdateAdvanceDirectiveSchema>;
