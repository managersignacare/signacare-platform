import { z } from 'zod';
import {
  PathwayInterventionPackSchema,
  PathwayInterventionTemplateKeySchema,
  PathwaySleepHygieneCheckInSchema,
  PathwayThoughtDiaryEntrySchema,
} from './treatmentPathway.Schemas';

export const StepCareRulePrioritySchema = z.enum(['medium', 'high', 'urgent']);
export type StepCareRulePriority = z.infer<typeof StepCareRulePrioritySchema>;

export const StepCareAssignmentScopeSchema = z.enum([
  'primary_clinician',
  'team_lead',
  'clinic_admin',
]);
export type StepCareAssignmentScope = z.infer<typeof StepCareAssignmentScopeSchema>;

export const StepCareRuleConditionSchema = z.object({
  moodBelowThreshold: z.number().min(0).max(10).nullable().optional(),
  anxietyAboveThreshold: z.number().min(0).max(10).nullable().optional(),
  sleepHoursBelow: z.number().min(0).max(24).nullable().optional(),
  phq9MinScore: z.number().int().min(0).max(27).nullable().optional(),
  gad7MinScore: z.number().int().min(0).max(21).nullable().optional(),
  riskIndexMin: z.number().min(0).max(100).nullable().optional(),
  minimumObservationDays: z.number().int().min(1).max(90).default(7),
  cooldownDays: z.number().int().min(1).max(90).default(7),
});
export type StepCareRuleCondition = z.infer<typeof StepCareRuleConditionSchema>;

export const StepCareRuleSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  pathwayType: z.string().min(1).max(80),
  interventionTemplateKey: PathwayInterventionTemplateKeySchema,
  autoAssignEnabled: z.boolean(),
  autoEscalateEnabled: z.boolean(),
  escalationPriority: StepCareRulePrioritySchema,
  assignmentScope: StepCareAssignmentScopeSchema,
  isActive: z.boolean(),
  expectedOutcomeText: z.string().nullable().optional(),
  conditions: StepCareRuleConditionSchema,
  lockVersion: z.number().int().nonnegative(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type StepCareRule = z.infer<typeof StepCareRuleSchema>;

export const CreateStepCareRuleSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  pathwayType: z.string().min(1).max(80),
  interventionTemplateKey: PathwayInterventionTemplateKeySchema,
  autoAssignEnabled: z.boolean().default(true),
  autoEscalateEnabled: z.boolean().default(true),
  escalationPriority: StepCareRulePrioritySchema.default('high'),
  assignmentScope: StepCareAssignmentScopeSchema.default('primary_clinician'),
  isActive: z.boolean().default(true),
  expectedOutcomeText: z.string().max(500).optional(),
  conditions: StepCareRuleConditionSchema,
});
export type CreateStepCareRuleDTO = z.infer<typeof CreateStepCareRuleSchema>;

export const UpdateStepCareRuleSchema = CreateStepCareRuleSchema.partial().extend({
  expectedLockVersion: z.number().int().positive(),
});
export type UpdateStepCareRuleDTO = z.infer<typeof UpdateStepCareRuleSchema>;

export const StepCareRuleEventTypeSchema = z.enum([
  'auto_assigned_pack',
  'auto_escalated_task',
]);
export type StepCareRuleEventType = z.infer<typeof StepCareRuleEventTypeSchema>;

export const StepCareRuleEventSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  ruleId: z.string().uuid(),
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().nullable().optional(),
  eventType: StepCareRuleEventTypeSchema,
  fingerprint: z.string(),
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type StepCareRuleEvent = z.infer<typeof StepCareRuleEventSchema>;

export const StepCareRuleListResponseSchema = z.object({
  rules: z.array(StepCareRuleSchema),
});
export type StepCareRuleListResponse = z.infer<typeof StepCareRuleListResponseSchema>;

export const WearableProviderSchema = z.enum([
  'apple_health',
  'google_fit',
  'fitbit',
  'garmin',
  'oura',
  'whoop',
  'manual_import',
]);
export type WearableProvider = z.infer<typeof WearableProviderSchema>;

export const WearableIntegrationModeSchema = z.enum(['manual', 'oauth']);
export type WearableIntegrationMode = z.infer<typeof WearableIntegrationModeSchema>;

export const WearableProviderCatalogItemSchema = z.object({
  provider: WearableProviderSchema,
  displayName: z.string().min(1).max(120),
  integrationMode: WearableIntegrationModeSchema,
  supportsBackfill: z.boolean(),
  supportsRealtimeWebhook: z.boolean(),
  isConfigured: z.boolean(),
  configuredEnvKeys: z.array(z.string().min(1).max(80)),
});
export type WearableProviderCatalogItem = z.infer<typeof WearableProviderCatalogItemSchema>;

export const WearableProviderCatalogResponseSchema = z.object({
  providers: z.array(WearableProviderCatalogItemSchema),
});
export type WearableProviderCatalogResponse = z.infer<typeof WearableProviderCatalogResponseSchema>;

export const WearableDeviceSourceSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  provider: WearableProviderSchema,
  deviceLabel: z.string().min(1).max(120),
  externalDeviceId: z.string().nullable().optional(),
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  lastIngestedAt: z.string().nullable().optional(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WearableDeviceSource = z.infer<typeof WearableDeviceSourceSchema>;

export const WearableDeviceSourceListResponseSchema = z.object({
  sources: z.array(WearableDeviceSourceSchema),
});
export type WearableDeviceSourceListResponse = z.infer<typeof WearableDeviceSourceListResponseSchema>;

export const WearableDeviceSourceCreateResponseSchema = z.object({
  source: WearableDeviceSourceSchema,
});
export type WearableDeviceSourceCreateResponse = z.infer<typeof WearableDeviceSourceCreateResponseSchema>;

export const CreateWearableDeviceSourceSchema = z.object({
  provider: WearableProviderSchema,
  deviceLabel: z.string().min(1).max(120),
  externalDeviceId: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateWearableDeviceSourceDTO = z.infer<typeof CreateWearableDeviceSourceSchema>;

export const UpdateWearableDeviceSourceSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  deviceLabel: z.string().min(1).max(120).optional(),
  externalDeviceId: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
  metadataPatch: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, ctx) => {
  const hasPatchField = value.deviceLabel !== undefined
    || value.externalDeviceId !== undefined
    || value.isActive !== undefined
    || value.metadataPatch !== undefined;
  if (!hasPatchField) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one mutable field must be provided',
      path: ['expectedLockVersion'],
    });
  }
});
export type UpdateWearableDeviceSourceDTO = z.infer<typeof UpdateWearableDeviceSourceSchema>;

export const WearableMetricTypeSchema = z.enum([
  'sleep_hours',
  'steps',
  'resting_hr',
  'hrv',
  'activity_minutes',
  'mood',
  'anxiety',
  'glucose_mgdl',
  'glucose_mmoll',
  'cgm_time_in_range_pct',
  'ecg_afib_flag',
  'ecg_afib_burden_pct',
  'ppg_irregular_rhythm_score',
]);
export type WearableMetricType = z.infer<typeof WearableMetricTypeSchema>;

export const WearableMetricEntrySchema = z.object({
  metricType: WearableMetricTypeSchema,
  value: z.number(),
  timestamp: z.string().optional(),
  note: z.string().max(500).optional(),
});
export type WearableMetricEntry = z.infer<typeof WearableMetricEntrySchema>;

export const WearableIngestBatchSchema = z.object({
  sourceId: z.string().uuid(),
  entries: z.array(WearableMetricEntrySchema).min(1).max(500),
});
export type WearableIngestBatchDTO = z.infer<typeof WearableIngestBatchSchema>;

export const RequestWearableSourceSyncSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  forceBackfill: z.boolean().optional().default(false),
  lookbackDays: z.number().int().min(1).max(180).optional().default(14),
});
export type RequestWearableSourceSyncDTO = z.infer<typeof RequestWearableSourceSyncSchema>;

export const WearableIngestOutcomeSchema = z.object({
  ingestedCount: z.number().int().nonnegative(),
});
export type WearableIngestOutcome = z.infer<typeof WearableIngestOutcomeSchema>;

export const WearableSourceSyncOutcomeSchema = z.object({
  accepted: z.boolean(),
  sourceId: z.string().uuid(),
  provider: WearableProviderSchema,
  integrationMode: WearableIntegrationModeSchema,
  syncRequestedAt: z.string(),
  reason: z.string().nullable().optional(),
});
export type WearableSourceSyncOutcome = z.infer<typeof WearableSourceSyncOutcomeSchema>;

export const DigitalPhenotypeBandSchema = z.enum([
  'low',
  'moderate',
  'high',
  'critical',
]);
export type DigitalPhenotypeBand = z.infer<typeof DigitalPhenotypeBandSchema>;

export const DigitalPhenotypeSnapshotSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  computationDay: z.string(),
  lookbackDays: z.number().int().positive(),
  sleepHoursAvg7d: z.number().nullable().optional(),
  stepsAvg7d: z.number().nullable().optional(),
  restingHrAvg7d: z.number().nullable().optional(),
  hrvAvg7d: z.number().nullable().optional(),
  moodAvg7d: z.number().nullable().optional(),
  anxietyAvg7d: z.number().nullable().optional(),
  adherenceScore: z.number().min(0).max(100),
  riskIndex: z.number().min(0).max(100),
  riskBand: DigitalPhenotypeBandSchema,
  contributingSignals: z.record(z.string(), z.number()).default({}),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DigitalPhenotypeSnapshot = z.infer<typeof DigitalPhenotypeSnapshotSchema>;

export const DigitalPhenotypeRowsResponseSchema = z.object({
  rows: z.array(DigitalPhenotypeSnapshotSchema),
});
export type DigitalPhenotypeRowsResponse = z.infer<typeof DigitalPhenotypeRowsResponseSchema>;

export const SurveillanceRiskBandSchema = z.enum([
  'low',
  'moderate',
  'high',
]);
export type SurveillanceRiskBand = z.infer<typeof SurveillanceRiskBandSchema>;

export const WearableSurveillanceSignalSchema = z.object({
  domain: z.enum(['depression_relapse', 'cgm_variability', 'arrhythmia']),
  score: z.number().min(0).max(100),
  riskBand: SurveillanceRiskBandSchema,
  summary: z.string().min(1).max(500),
  recommendedAction: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});
export type WearableSurveillanceSignal = z.infer<typeof WearableSurveillanceSignalSchema>;

export const WearableSurveillanceSnapshotSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  classification: z.literal('surveillance'),
  actionability: z.literal('clinical_review_required'),
  disclaimer: z.string().min(1).max(500),
  signals: z.array(WearableSurveillanceSignalSchema),
});
export type WearableSurveillanceSnapshot = z.infer<typeof WearableSurveillanceSnapshotSchema>;

export const PathwayPatientInterventionsResponseSchema = z.object({
  pathwayId: z.string().uuid(),
  pathwayName: z.string().min(1),
  lockVersion: z.number().int().nonnegative(),
  packs: z.array(PathwayInterventionPackSchema),
  thoughtDiaryEntries: z.array(PathwayThoughtDiaryEntrySchema),
  sleepJourneyCheckIns: z.array(PathwaySleepHygieneCheckInSchema),
});
export type PathwayPatientInterventionsResponse = z.infer<typeof PathwayPatientInterventionsResponseSchema>;

export const PathwayTemplateEffectivenessSchema = z.object({
  templateKey: PathwayInterventionTemplateKeySchema,
  assignedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  completionRatePct: z.number().min(0).max(100),
});
export type PathwayTemplateEffectiveness = z.infer<typeof PathwayTemplateEffectivenessSchema>;

export const PathwayResearchLaneSummarySchema = z.object({
  clinicId: z.string().uuid(),
  periodDays: z.number().int().positive(),
  activePathways: z.number().int().nonnegative(),
  assignedInterventionPacks: z.number().int().nonnegative(),
  interventionCompletionRatePct: z.number().min(0).max(100),
  thoughtDiaryEntries: z.number().int().nonnegative(),
  sleepJourneyCheckIns: z.number().int().nonnegative(),
  stepCareRulesActive: z.number().int().nonnegative(),
  stepCareAutoAssignments: z.number().int().nonnegative(),
  stepCareEscalations: z.number().int().nonnegative(),
  digitalPhenotypingCoveragePct: z.number().min(0).max(100),
  outcomeDelta: z.object({
    phq9AverageDelta: z.number().nullable().optional(),
    gad7AverageDelta: z.number().nullable().optional(),
    cohortSize: z.number().int().nonnegative(),
  }),
  templateEffectiveness: z.array(PathwayTemplateEffectivenessSchema),
});
export type PathwayResearchLaneSummary = z.infer<typeof PathwayResearchLaneSummarySchema>;
