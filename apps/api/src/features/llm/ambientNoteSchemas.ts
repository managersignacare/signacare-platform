import { z } from 'zod';

const AMBIENT_NOTE_FORMATS = [
  'soap',
  'mse',
  'progress',
  'intake',
  'ward_round',
  'review',
  'collateral',
  'phone',
  'home_visit',
  'case_conference',
  'group',
  'incident',
  'physical_health',
  'lai',
  'clozapine',
  'all',
] as const;

export const AmbientNoteRequestSchema = z.object({
  patientId: z.string().uuid(
    'patientId must be a valid UUID — required for recording-consent verification (BUG-035)',
  ),
  consentId: z.string().uuid(
    'consentId must be a valid UUID — capture via POST /api/v1/scribe/consent before recording (BUG-035)',
  ),
  format: z.enum(AMBIENT_NOTE_FORMATS).optional(),
  model: z.string().max(128).optional(),
  interpreterUsed: z.union([z.boolean(), z.string()]).optional(),
  interpreterLanguage: z.string().max(64).optional(),
  multiSpeakerMode: z.union([z.boolean(), z.string()]).optional(),
});
