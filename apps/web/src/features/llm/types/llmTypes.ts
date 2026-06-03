// apps/web/src/features/llm/types/llmTypes.ts
import { z } from 'zod';

export const LLMSourceSchema = z.enum([
  'voice_transcript', 'ambient', 'manual', 'note_history',
]);
export type LLMSource = z.infer<typeof LLMSourceSchema>;

export const LLMSuggestionTypeSchema = z.enum([
  'soap_note',
  'clinical_summary',
  'referral_letter',
  'risk_analysis',
  'medication_review',
  'discharge_summary',
  'care_plan',
]);
export type LLMSuggestionType = z.infer<typeof LLMSuggestionTypeSchema>;

export const LLMStatusSchema = z.enum(['idle', 'loading', 'success', 'error']);
export type LLMStatus = z.infer<typeof LLMStatusSchema>;

// ── Request payloads ─────────────────────────────────────────────────────────

export const SOAPGenerateRequestSchema = z.object({
  patientId: z.string().uuid(),
  encounterId: z.string().uuid().optional(),
  transcript: z.string().min(50).max(50000),
  source: LLMSourceSchema,
});
export type SOAPGenerateRequest = z.infer<typeof SOAPGenerateRequestSchema>;

export const SummaryGenerateRequestSchema = z.object({
  patientId: z.string().uuid(),
  noteHistory: z.string().min(50).max(100000),
});
export type SummaryGenerateRequest = z.infer<typeof SummaryGenerateRequestSchema>;

export const ReferralLetterRequestSchema = z.object({
  patientId: z.string().uuid(),
  context: z.string().min(50).max(20000),
  recipientName: z.string().optional(),
  recipientOrg: z.string().optional(),
});
export type ReferralLetterRequest = z.infer<typeof ReferralLetterRequestSchema>;

export const RiskAnalysisRequestSchema = z.object({
  patientId: z.string().uuid(),
  riskFactors: z.string().min(20).max(10000),
});
export type RiskAnalysisRequest = z.infer<typeof RiskAnalysisRequestSchema>;

// ── Response shapes ──────────────────────────────────────────────────────────

export const SOAPNoteSchema = z.object({
  subjective: z.string(),
  objective: z.string(),
  assessment: z.string(),
  plan: z.string(),
  aiGenerated: z.literal(true),
  requiresReview: z.literal(true),
});
export type SOAPNote = z.infer<typeof SOAPNoteSchema>;

export const LLMHealthSchema = z.object({
  available: z.boolean(),
  model: z.enum(['connected', 'unavailable']),
});
export type LLMHealth = z.infer<typeof LLMHealthSchema>;

// BUG-457 — `LLMInteractionSchema` and `LLMInteraction` were drift
// artefacts: they redeclared a fictional 7-value taxonomy with zero
// overlap with the SSoT `LlmInteractionResponseSchema` in
// `@signacare/shared`, AND zero `.parse()` consumers, AND zero type
// imports. Pure duplicate-API-types violation per CLAUDE.md §5.1
// "Define response types in `packages/shared/src/` — this is the SSoT".
// Frontend that needs the LLM interaction shape MUST import
// `LlmInteractionResponse` from `@signacare/shared`.

// ── UI state ─────────────────────────────────────────────────────────────────

export interface LLMSuggestionState {
  type: LLMSuggestionType | null;
  status: LLMStatus;
  result: SOAPNote | string | null;
  error: string | null;
  source: LLMSource | null;
}
