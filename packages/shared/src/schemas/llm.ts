import { z } from 'zod';

export const AmbientDraftResponseSchema = z.object({
  subjectiveHtml: z.string(),
  objectiveHtml: z.string(),
  assessmentHtml: z.string(),
  planHtml: z.string(),
  rawTranscript: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type LLMSoapResponse = z.infer<
  typeof AmbientDraftResponseSchema
>;
