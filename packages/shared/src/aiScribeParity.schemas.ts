import { z } from 'zod';

export const AiScribeParityCapabilitySchema = z.enum([
  'realtime_in_visit_documentation',
  'au_document_generation',
  'per_clinician_style_learning',
  'structured_mse_citations',
  'shared_lineage_keying',
  'outcome_telemetry',
]);

export const AI_SCRIBE_PARITY_CAPABILITIES = AiScribeParityCapabilitySchema.options;

export const AiScribeCapabilitiesResponseSchema = z.object({
  schemaVersion: z.literal('1.0'),
  activePath: z.literal('async-ai-scribe-v2'),
  capabilities: z.array(AiScribeParityCapabilitySchema).length(AI_SCRIBE_PARITY_CAPABILITIES.length),
  stagingSmokeRequired: z.boolean(),
  productionSmokeRequired: z.literal(true),
});

export const AuScribeDocumentKindSchema = z.enum([
  'gp_referral_letter',
  'mental_health_care_plan',
  'medical_certificate',
  'court_report_291',
  'mha_tribunal_report',
  'discharge_summary',
  'after_visit_summary',
]);

export const ScribeArtifactSourceKindSchema = z.enum([
  'in_visit_draft',
  'ambient_note',
  'async_job',
  'au_document',
  'clinical_note',
  'post_sign',
]);

export const ScribeArtifactLineageSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sourceKind: ScribeArtifactSourceKindSchema,
  patientId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  jobId: z.string().uuid().nullable(),
  sourceNoteId: z.string().uuid().nullable(),
  documentKind: AuScribeDocumentKindSchema.nullable(),
  canonicalTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  lineageKey: z.string().regex(/^[a-f0-9]{48}$/),
});

export const ScribeRealtimeDraftSnapshotSchema = z.object({
  patientId: z.string().uuid().optional(),
  sourceChunkIndex: z.number().int().nonnegative(),
  partialTranscript: z.string().min(1).max(200_000),
  draftSections: z.record(z.string().min(1).max(60), z.string().max(20_000)).default({}),
  mseStructuredPresent: z.boolean().default(false),
  generatedAt: z.string().datetime().optional(),
});

export const ScribeRealtimeDraftSnapshotResponseSchema = z.object({
  schemaVersion: z.literal('1.0'),
  sessionId: z.string().uuid(),
  patientId: z.string().uuid(),
  sourceChunkIndex: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
  partialTranscriptChars: z.number().int().positive(),
  lineage: ScribeArtifactLineageSchema,
  rawDraftPersisted: z.literal(false),
});

export const AuScribeDocumentRequestSchema = z.object({
  documentKind: AuScribeDocumentKindSchema,
  templateId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  subject: z.string().min(1).max(240).optional(),
  recipients: z
    .array(z.object({
      name: z.string().min(1).max(200),
      address: z.string().max(500).optional(),
      email: z.string().email().optional(),
      role: z.string().max(80).optional(),
    }))
    .max(20)
    .optional(),
});

export const AuScribeDocumentResponseSchema = z.object({
  schemaVersion: z.literal('1.0'),
  documentKind: AuScribeDocumentKindSchema,
  letterId: z.string().uuid(),
  templateId: z.string().uuid(),
  status: z.literal('draft'),
  sectionCount: z.number().int().nonnegative(),
  lineage: ScribeArtifactLineageSchema,
});

export const ScribeStyleFeedbackSchema = z.object({
  patientId: z.string().uuid().optional(),
  interactionId: z.string().uuid().optional(),
  source: z.enum(['ambient_note', 'clinical_ai', 'au_document', 'mse_section', 'summary_section']),
  noteType: z.string().min(1).max(80).default('ambient'),
  originalText: z.string().min(1).max(40_000),
  editedText: z.string().min(1).max(40_000),
  rating: z.number().int().min(1).max(5).optional(),
  feedbackNotes: z.string().max(1000).optional(),
  clinicianOptInConfirmed: z.literal(true),
});

export const ScribeStyleFeedbackResponseSchema = z.object({
  schemaVersion: z.literal('1.0'),
  feedbackId: z.string().uuid(),
  styleLearningMode: z.literal('derived-feedback-pending-adapter-consent'),
  clinicianOptInConfirmed: z.literal(true),
});

export const ScribeOutcomeTelemetryEventSchema = z.enum([
  'recording_started',
  'partial_draft_generated',
  'draft_completed',
  'au_document_draft_created',
  'note_inserted',
  'signed',
  'edited',
  'feedback_submitted',
  'exported',
]);

export const ScribeOutcomeTelemetrySchema = z.object({
  patientId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  documentKind: AuScribeDocumentKindSchema.optional(),
  event: ScribeOutcomeTelemetryEventSchema,
  latencyMs: z.number().int().nonnegative().optional(),
  editDistanceRatio: z.number().min(0).max(1).optional(),
  acceptedWithoutEdit: z.boolean().optional(),
  clinicianSatisfaction: z.number().int().min(1).max(5).optional(),
  lineageKey: z.string().regex(/^[a-f0-9]{48}$/).optional(),
});

export const ScribeOutcomeTelemetryResponseSchema = z.object({
  schemaVersion: z.literal('1.0'),
  recorded: z.literal(true),
  event: ScribeOutcomeTelemetryEventSchema,
});

export type AiScribeParityCapability = z.infer<typeof AiScribeParityCapabilitySchema>;
export type AiScribeCapabilitiesResponse = z.infer<typeof AiScribeCapabilitiesResponseSchema>;
export type AuScribeDocumentKind = z.infer<typeof AuScribeDocumentKindSchema>;
export type ScribeArtifactLineage = z.infer<typeof ScribeArtifactLineageSchema>;
export type ScribeRealtimeDraftSnapshot = z.infer<typeof ScribeRealtimeDraftSnapshotSchema>;
export type ScribeOutcomeTelemetry = z.infer<typeof ScribeOutcomeTelemetrySchema>;
