// packages/shared/src/llm.schemas.ts
import { z } from 'zod';

// BUG-457 — UNION of:
//   (a) historical SSoT enum (kept for back-compat with any consumer
//       that hard-coded these values).
//   (b) production literal writes verified at HEAD by Plan-agent grep:
//       `'ambient'`, `'ai-agent'`, `'scribe-patient-summary'`,
//       `'scribe-referral-letter'`, `'scribe-search'`.
//   (c) template-literal shapes: `document_*`, `clinical-ai:*`,
//       `suggest:*` — admitted via prefix regex.
//   (d) free-form `feedback.action` (training pipeline) — admitted via
//       a 1-50-char string fallback bounded by the DB column width.
//       The DB has no CHECK constraint today, so any short string is
//       legitimate clinical-feedback input.
//
// Strategy: literal enum for the 11 known fixed values + 3 prefix-
// regex members for the templates + a permissive 1-50-char fallback.
// Audit-friendly because the enum members are the machine-checkable
// surface; the regex/string fallback handles the long tail without
// silently dropping rows.
//
// Follow-up BUG-512 (S2 post-staging): tighten to enum-only after a
// 30-day production observation window — if no template-literal /
// free-form values surface that aren't already enumerated, collapse
// to a closed enum + add DB CHECK.
export const LlmFeatureSchema = z.union([
  z.enum([
    // Historical SSoT
    'ambient_note',
    'suggestion',
    'summarisation',
    'risk_flag',
    'coding_assist',
    'other',
    // Production literals (verified 2026-04-25)
    'ambient',
    'ai-agent',
    'scribe-patient-summary',
    'scribe-referral-letter',
    'scribe-search',
  ]),
  // Template-literal shapes
  z.string().regex(/^document_[a-z0-9_-]{1,40}$/),
  z.string().regex(/^clinical-ai:[a-z0-9_-]{1,40}$/),
  z.string().regex(/^suggest:(ambient_note|suggestion|summarisation|risk_flag|coding_assist|other)$/),
  // Free-form feedback.action (DB has no CHECK; clinician input)
  z.string().min(1).max(50),
]);
export type LlmFeature = z.infer<typeof LlmFeatureSchema>;

export const LlmInteractionWriteDTOSchema = z.object({
  patientId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  feature: LlmFeatureSchema,
  modelName: z.string().min(1).max(100),
  modelProvider: z.string().max(50).optional(),
  promptTokens: z.number().int().min(0).optional(),
  completionTokens: z.number().int().min(0).optional(),
  totalTokens: z.number().int().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  success: z.boolean().default(true),
  errorCode: z.string().max(50).optional(),
  inputRef: z.string().max(500).optional(),  // S3 key – never raw text
  outputRef: z.string().max(500).optional(), // S3 key – never raw text
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type LlmInteractionWriteDTO = z.infer<typeof LlmInteractionWriteDTOSchema>;

export const LlmInteractionResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  patientId: z.string().uuid().nullable(),
  episodeId: z.string().uuid().nullable(),
  feature: z.string(),
  modelName: z.string(),
  modelProvider: z.string().nullable(),
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  success: z.boolean(),
  errorCode: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type LlmInteractionResponse = z.infer<typeof LlmInteractionResponseSchema>;

export const LlmUsageDaySummarySchema = z.object({
  usageDate: z.string(), // YYYY-MM-DD
  feature: z.string(),
  modelName: z.string(),
  callCount: z.number().int(),
  totalTokensUsed: z.number().int(),
  totalPromptTokens: z.number().int(),
  totalCompletionTokens: z.number().int(),
  avgLatencyMs: z.number().int().nullable(),
  errorCount: z.number().int(),
});
export type LlmUsageDaySummary = z.infer<typeof LlmUsageDaySummarySchema>;

export const LlmInteractionSummaryResponseSchema = z.object({
  clinicId: z.string().uuid(),
  dateFrom: z.string(),
  dateTo: z.string(),
  byDay: z.array(LlmUsageDaySummarySchema),
  totals: z.object({
    callCount: z.number().int(),
    totalTokensUsed: z.number().int(),
    errorCount: z.number().int(),
    avgLatencyMs: z.number().int().nullable(),
  }),
});
export type LlmInteractionSummaryResponse = z.infer<
  typeof LlmInteractionSummaryResponseSchema
>;

export const LlmSuggestionRequestSchema = z.object({
  feature: z.enum(['suggestion', 'summarisation', 'coding_assist']),
  // Reference to encrypted input payload – callers MUST NOT pass raw clinical text
  contextRef: z.string().max(500),
  modelName: z.string().max(100).optional(),
  modelProvider: z.string().max(50).optional(),
  /**
   * BUG-327 — when the contextRef is constructed from patient data,
   * the caller MUST supply patientId so the server can run
   * requirePatientRelationship before invoking the LLM. Optional
   * because some /suggest calls are patient-agnostic (e.g. generic
   * summarisation, coding_assist without a specific patient record).
   * When present, the gate runs; when absent, the gate is skipped
   * but writeLlmAccessBypassAudit still fires to surface bypass-role
   * usage.
   */
  patientId: z.string().uuid().optional(),
});
export type LlmSuggestionRequest = z.infer<typeof LlmSuggestionRequestSchema>;

export const LlmSuggestionResponseSchema = z.object({
  interactionId: z.string().uuid(),
  outputRef: z.string().nullable(), // S3 key to encrypted output
  success: z.boolean(),
  latencyMs: z.number().int(),
});
export type LlmSuggestionResponse = z.infer<typeof LlmSuggestionResponseSchema>;

export const HfInferenceSchema = z.object({
  text: z.string().min(1).max(50000),
  model: z.string().max(200).optional(),
  task: z.string().max(100).optional(),
});
export type HfInferenceDTO = z.infer<typeof HfInferenceSchema>;

export const HfClassifySchema = z.object({
  text: z.string().min(1).max(50000),
  model: z.string().max(200).optional(),
});
export type HfClassifyDTO = z.infer<typeof HfClassifySchema>;

export const HfEntitiesSchema = z.object({
  text: z.string().min(1).max(50000),
});
export type HfEntitiesDTO = z.infer<typeof HfEntitiesSchema>;

export const HfDownloadSchema = z.object({
  model: z.string().min(1).max(200),
});
export type HfDownloadDTO = z.infer<typeof HfDownloadSchema>;

export const ClinicalAiSchema = z.object({
  action: z.string().min(1).max(100),
  data: z.unknown(),
  model: z.string().max(200).optional(),
  patientId: z.string().uuid().optional(),
  /**
   * Explicit purpose-of-use for policy gating. Clinical tools default to
   * `clinical` when omitted by legacy clients.
   */
  purposeOfUse: z.enum(['clinical', 'operational', 'analytics']).optional(),
  enhance: z.union([z.boolean(), z.literal('draft')]).optional(),
  templateType: z.string().max(200).optional(),
  // BUG-395 — AI chat patient-context UUID lock. A client-generated
  // UUID that identifies a single conversation. When both conversationId
  // AND patientId are present, the backend acquires a per-conversation
  // lock mapping conversationId → patientId. Subsequent requests with
  // the same conversationId but a DIFFERENT patientId are rejected 409
  // CHAT_CONTEXT_LOCKED — prevents cross-patient prompt/RAG contamination
  // mid-session.
  //
  // L4 absorb 2026-04-24: REQUIRED (was optional) — an optional-during-
  // rollout window leaves the cross-patient leak live for every call
  // that forgets the field. Frontends MUST generate a UUID on chat
  // component mount (typically via crypto.randomUUID()) and re-generate
  // on patient-change.
  conversationId: z.string().uuid(),
});
export type ClinicalAiDTO = z.infer<typeof ClinicalAiSchema>;

export const AiScopeLevelSchema = z.enum(['patient', 'team', 'staff', 'clinic']);
export type AiScopeLevel = z.infer<typeof AiScopeLevelSchema>;

export const AiStructuredScopeSchema = z.object({
  level: AiScopeLevelSchema,
  patientIds: z.array(z.string().uuid()).optional(),
  teamIds: z.array(z.string().uuid()).optional(),
  staffIds: z.array(z.string().uuid()).optional(),
  // Optional human labels for traceability in audit payloads.
  teamLabels: z.array(z.string().min(1).max(200)).optional(),
  staffLabels: z.array(z.string().min(1).max(200)).optional(),
  timeRangeFrom: z.string().datetime().optional(),
  timeRangeTo: z.string().datetime().optional(),
}).superRefine((scope, ctx) => {
  if (scope.level === 'patient') {
    if (!scope.patientIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patient scope requires patientIds',
        path: ['patientIds'],
      });
    }
  }
  if (scope.level === 'team') {
    if (!scope.teamIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'team scope requires teamIds',
        path: ['teamIds'],
      });
    }
  }
  if (scope.level === 'staff') {
    if (!scope.staffIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'staff scope requires staffIds',
        path: ['staffIds'],
      });
    }
  }
});
export type AiStructuredScope = z.infer<typeof AiStructuredScopeSchema>;

export const AiDecisionTokenSchema = z.object({
  tokenId: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  role: z.string().min(1).max(100),
  permissions: z.array(z.string().min(1)),
  allowedTools: z.array(z.string().min(1)).optional(),
  purposeOfUse: z.enum(['clinical', 'operational', 'analytics']),
  scope: AiStructuredScopeSchema.optional(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  signature: z.string().min(20),
});
export type AiDecisionToken = z.infer<typeof AiDecisionTokenSchema>;

export const AiAgentSchema = z.object({
  query: z.string().min(1).max(10000),
  patientId: z.string().uuid().optional(),
  model: z.string().max(200).optional(),
  purposeOfUse: z.enum(['clinical', 'operational', 'analytics']).optional(),
  scope: AiStructuredScopeSchema.optional(),
});
export type AiAgentDTO = z.infer<typeof AiAgentSchema>;

export const McpRequestSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  method: z.string().min(1).max(200),
  params: z.unknown().optional(),
  // @zod-convention-exempt: JSON-RPC 2.0 spec mandates `id` is `string | number | null` (https://www.jsonrpc.org/specification §4); not a Signacare row UUID.
  id: z.union([z.string(), z.number()]).optional(),
});
export type McpRequestDTO = z.infer<typeof McpRequestSchema>;

export const AiFeedbackSchema = z.object({
  feedbackType: z.string().max(100).optional(),
  interactionId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  originalOutput: z.string().max(50000).optional(),
  correctedOutput: z.string().max(50000).optional(),
  notes: z.string().max(5000).optional(),
}).passthrough();
export type AiFeedbackDTO = z.infer<typeof AiFeedbackSchema>;
