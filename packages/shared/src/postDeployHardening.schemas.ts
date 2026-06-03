import { z } from 'zod';

import {
  ClinicalIntelligenceSourceSchema,
  ClinicalIntelligenceStateSchema,
} from './patientClinicalIntelligence.schemas';

export const PostDeployStageSchema = z.enum(['prework_ready', 'telemetry_window', 'ga_gate']);
export type PostDeployStage = z.infer<typeof PostDeployStageSchema>;

export const DiagnosisProgramBucketSchema = z.enum([
  'mood',
  'psychotic',
  'anxiety_trauma',
  'personality',
  'substance',
  'neurodevelopmental',
  'other',
  'unknown',
]);
export type DiagnosisProgramBucket = z.infer<typeof DiagnosisProgramBucketSchema>;

export const ServiceProgramBucketSchema = z.enum([
  'community',
  'inpatient',
  'crisis',
  'day_program',
  'other',
  'unknown',
]);
export type ServiceProgramBucket = z.infer<typeof ServiceProgramBucketSchema>;

export const ClinicalIntelligenceCalibrationSignalSchema = z.object({
  state: ClinicalIntelligenceStateSchema,
  failedSources: z.array(ClinicalIntelligenceSourceSchema),
  diagnosisProgramBucket: DiagnosisProgramBucketSchema,
  serviceProgramBucket: ServiceProgramBucketSchema,
  generatedAt: z.string().datetime(),
});
export type ClinicalIntelligenceCalibrationSignal = z.infer<typeof ClinicalIntelligenceCalibrationSignalSchema>;

export const SummarySourceReliabilitySignalSchema = z.object({
  state: ClinicalIntelligenceStateSchema,
  failedSources: z.array(ClinicalIntelligenceSourceSchema),
  generatedAt: z.string().datetime(),
});
export type SummarySourceReliabilitySignal = z.infer<typeof SummarySourceReliabilitySignalSchema>;

export const PatientDetailReadModelTargetSchema = z.object({
  routeKey: z.string().min(1).max(120),
  tabKey: z.string().min(1).max(120),
  owner: z.string().min(1).max(120),
  targetStage: PostDeployStageSchema,
});
export type PatientDetailReadModelTarget = z.infer<typeof PatientDetailReadModelTargetSchema>;

export const ReadabilityLanguageBucketSchema = z.enum([
  'english',
  'latin_non_english',
  'non_latin',
  'unknown',
]);
export type ReadabilityLanguageBucket = z.infer<typeof ReadabilityLanguageBucketSchema>;

export const ReadabilityBandSchema = z.enum([
  'clear',
  'borderline',
  'dense',
  'unscored_non_english',
  'unscored_unknown',
]);
export type ReadabilityBand = z.infer<typeof ReadabilityBandSchema>;

export const ScribeReadabilitySignalSchema = z.object({
  feature: z.string().min(1).max(80),
  language: ReadabilityLanguageBucketSchema,
  band: ReadabilityBandSchema,
  score: z.number().finite().min(0).max(120).nullable(),
  generatedAt: z.string().datetime(),
});
export type ScribeReadabilitySignal = z.infer<typeof ScribeReadabilitySignalSchema>;

export const AiEditTrackingPrivacyModeSchema = z.enum([
  'metadata_only',
  'hash_plus_metrics',
  'full_diff_with_consent',
]);
export type AiEditTrackingPrivacyMode = z.infer<typeof AiEditTrackingPrivacyModeSchema>;

export const AiEditTrackingPrivacyContractSchema = z.object({
  mode: AiEditTrackingPrivacyModeSchema,
  consentRequired: z.boolean(),
  retentionDays: z.number().int().min(1).max(3650),
  enabled: z.boolean(),
  stage: PostDeployStageSchema,
});
export type AiEditTrackingPrivacyContract = z.infer<typeof AiEditTrackingPrivacyContractSchema>;

export const ScribeSpeakerRoleSchema = z.enum([
  'clinician',
  'patient',
  'family',
  'carer',
  'interpreter',
  'other',
  'unknown',
]);
export type ScribeSpeakerRole = z.infer<typeof ScribeSpeakerRoleSchema>;

export const ScribeSpeakerAttributionContractSchema = z.object({
  multiSpeakerGaEnabled: z.boolean(),
  diarisationRequired: z.boolean(),
  allowedRoles: z.array(ScribeSpeakerRoleSchema).min(1),
  stage: PostDeployStageSchema,
});
export type ScribeSpeakerAttributionContract = z.infer<typeof ScribeSpeakerAttributionContractSchema>;

export const AlertCalibrationOutcomeSchema = z.enum(['helpful', 'noise', 'missed']);
export type AlertCalibrationOutcome = z.infer<typeof AlertCalibrationOutcomeSchema>;

export const AlertCalibrationSignalTypeSchema = z.enum([
  'clinical_intelligence',
  'ai_summary_risk',
  'review_due_prompt',
  'task_escalation_prompt',
]);
export type AlertCalibrationSignalType = z.infer<typeof AlertCalibrationSignalTypeSchema>;

export const AlertCalibrationFeedbackSignalSchema = z.object({
  signalType: AlertCalibrationSignalTypeSchema,
  outcome: AlertCalibrationOutcomeSchema,
  generatedAt: z.string().datetime(),
});
export type AlertCalibrationFeedbackSignal = z.infer<typeof AlertCalibrationFeedbackSignalSchema>;
