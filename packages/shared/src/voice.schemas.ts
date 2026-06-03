// packages/shared/src/voice.schemas.ts
import { z } from 'zod';

export const VoiceCallCreateDTOSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  scriptId: z.string().uuid().optional(),
  direction: z.enum(['inbound', 'outbound']).default('outbound'),
  notes: z.string().max(1000).optional(),
});
export type VoiceCallCreateDTO = z.infer<typeof VoiceCallCreateDTOSchema>;

export const VoiceCallUpdateDTOSchema = z
  .object({
    status: z
      .enum(['initiated', 'ringing', 'in_progress', 'completed', 'failed', 'no_answer', 'voicemail'])
      .optional(),
    durationSeconds: z.number().int().min(0).optional(),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    callSid: z.string().max(100).optional(),
    transcriptAvailable: z.boolean().optional(),
    transcriptS3Key: z.string().max(500).optional(),
    outcome: z.string().max(100).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();
export type VoiceCallUpdateDTO = z.infer<typeof VoiceCallUpdateDTOSchema>;

export const VoiceCallResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  scriptId: z.string().uuid().nullable(),
  initiatedById: z.string().uuid().nullable(),
  direction: z.enum(['inbound', 'outbound']),
  status: z.string(),
  phoneNumberMasked: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  callSid: z.string().nullable(),
  transcriptAvailable: z.boolean(),
  outcome: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VoiceCallResponse = z.infer<typeof VoiceCallResponseSchema>;

export const VoiceScriptCreateDTOSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  scriptType: z.enum([
    'appointment_reminder', 'medication_reminder', 'general', 'outreach', 'crisis',
  ]),
  content: z.string().min(1),
  isActive: z.boolean().default(true),
});
export type VoiceScriptCreateDTO = z.infer<typeof VoiceScriptCreateDTOSchema>;

export const VoiceScriptResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  scriptType: z.string(),
  version: z.number().int(),
  content: z.string(),
  isActive: z.boolean(),
  createdById: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VoiceScriptResponse = z.infer<typeof VoiceScriptResponseSchema>;

export const VoicePatientPreferencesDTOSchema = z.object({
  optedOut: z.boolean(),
  preferredCallStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM')
    .optional(),
  preferredCallEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Must be HH:MM')
    .optional(),
  preferredDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});
export type VoicePatientPreferencesDTO = z.infer<typeof VoicePatientPreferencesDTOSchema>;

export const VoicePatientPreferencesResponseSchema =
  VoicePatientPreferencesDTOSchema.extend({
    id: z.string().uuid(),
    clinicId: z.string().uuid(),
    patientId: z.string().uuid(),
    optedOutAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  });
export type VoicePatientPreferencesResponse = z.infer<
  typeof VoicePatientPreferencesResponseSchema
>;
