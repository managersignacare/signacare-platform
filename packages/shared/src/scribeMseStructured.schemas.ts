import { z } from 'zod';

/**
 * BUG-SCRIBE25-004
 *
 * Canonical structured MSE contract used by AI scribe outputs.
 * Cardinality rule:
 * - Any assessed domain MUST carry >=1 citation.
 * - Not-assessed domains MUST carry 0 citations.
 */

export const MseCitationSchema = z.object({
  sourceType: z.enum(['transcript', 'clinical_note', 'patient_message', 'other']),
  sourceId: z.string().uuid().nullable().optional(),
  excerpt: z.string().min(1).max(500),
  startOffset: z.number().int().nonnegative().nullable().optional(),
  endOffset: z.number().int().nonnegative().nullable().optional(),
});

export const MseDomainStateSchema = z
  .object({
    finding: z.string().min(1).max(400),
    certainty: z.enum(['observed', 'reported', 'inferred', 'not_assessed']),
    citations: z.array(MseCitationSchema),
  })
  .superRefine((value, ctx) => {
    const count = value.citations.length;
    if (value.certainty === 'not_assessed' && count !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'not_assessed domains must not include citations',
        path: ['citations'],
      });
    }
    if (value.certainty !== 'not_assessed' && count < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assessed domains require at least one citation',
        path: ['citations'],
      });
    }
  });

export const MseStructuredSchema = z.object({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.string().datetime(),
  sourceSessionId: z.string().uuid().nullable(),
  domains: z.object({
    appearance: MseDomainStateSchema.optional(),
    behaviour: MseDomainStateSchema.optional(),
    speech: MseDomainStateSchema.optional(),
    mood: MseDomainStateSchema.optional(),
    affect: MseDomainStateSchema.optional(),
    thoughtForm: MseDomainStateSchema.optional(),
    thoughtContent: MseDomainStateSchema.optional(),
    perception: MseDomainStateSchema.optional(),
    cognition: MseDomainStateSchema.optional(),
    insight: MseDomainStateSchema.optional(),
    judgement: MseDomainStateSchema.optional(),
  }),
});

export type MseCitation = z.infer<typeof MseCitationSchema>;
export type MseDomainState = z.infer<typeof MseDomainStateSchema>;
export type MseStructured = z.infer<typeof MseStructuredSchema>;
