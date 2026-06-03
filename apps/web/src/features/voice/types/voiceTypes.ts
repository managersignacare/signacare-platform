// apps/web/src/features/voice/types/voiceTypes.ts
import { z } from 'zod';

export const CallDirectionSchema = z.enum(['inbound', 'outbound']);
export const CallStatusSchema = z.enum([
  'queued', 'ringing', 'in_progress', 'completed', 'failed', 'busy', 'no_answer', 'cancelled',
]);
export const TranscriptStatusSchema = z.enum([
  'pending', 'processing', 'completed', 'failed', 'unavailable',
]);

export const VoiceCallSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  staffId: z.string().uuid().nullable(),
  staffName: z.string().nullable(),
  direction: CallDirectionSchema,
  status: CallStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().nullable(),
  callerNumber: z.string().nullable(),
  calledNumber: z.string().nullable(),
  recordingUrl: z.string().url().nullable(),
  transcriptStatus: TranscriptStatusSchema,
  transcriptId: z.string().uuid().nullable(),
  optedOutOfRecording: z.boolean(),
  episodeId: z.string().uuid().nullable(),
  encounterId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type VoiceCall = z.infer<typeof VoiceCallSchema>;

export const VoiceTranscriptSegmentSchema = z.object({
  speaker: z.enum(['clinician', 'patient', 'unknown']),
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
  confidence: z.number().nullable(),
});
export type VoiceTranscriptSegment = z.infer<typeof VoiceTranscriptSegmentSchema>;

export const VoiceTranscriptSchema = z.object({
  id: z.string().uuid(),
  callId: z.string().uuid(),
  patientId: z.string().uuid(),
  segments: z.array(VoiceTranscriptSegmentSchema),
  fullText: z.string(),
  durationMs: z.number(),
  language: z.string().default('en-AU'),
  processedAt: z.string().datetime(),
  aiSummary: z.string().nullable(),
  consentVerified: z.boolean(),
});
export type VoiceTranscript = z.infer<typeof VoiceTranscriptSchema>;

export const VoiceOptOutSchema = z.object({
  patientId: z.string().uuid(),
  optedOut: z.boolean(),
  reason: z.string().optional(),
});
export type VoiceOptOut = z.infer<typeof VoiceOptOutSchema>;

export const VoiceCallFiltersSchema = z.object({
  patientId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  direction: CallDirectionSchema.optional(),
  status: CallStatusSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().default(50),
  offset: z.number().default(0),
});
export type VoiceCallFilters = z.infer<typeof VoiceCallFiltersSchema>;
