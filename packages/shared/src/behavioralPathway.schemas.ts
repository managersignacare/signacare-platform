import { z } from 'zod';

export const BehaviorContractAdherenceStatusSchema = z.enum([
  'on_track',
  'at_risk',
  'missed',
  'completed',
  'paused',
]);
export type BehaviorContractAdherenceStatus = z.infer<typeof BehaviorContractAdherenceStatusSchema>;

export const BehaviorContractSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().nullable().optional(),
  triggerText: z.string().min(1).max(2000),
  commitmentBehavior: z.string().min(1).max(2000),
  fallbackPlan: z.string().min(1).max(2000),
  reviewDate: z.string(),
  accountabilityPartner: z.string().max(240).nullable().optional(),
  adherenceStatus: BehaviorContractAdherenceStatusSchema,
  adherenceNote: z.string().max(2000).nullable().optional(),
  lastAdherenceCheckAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean(),
  lockVersion: z.number().int().nonnegative(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BehaviorContract = z.infer<typeof BehaviorContractSchema>;

export const BehaviorContractListResponseSchema = z.object({
  contracts: z.array(BehaviorContractSchema),
});
export type BehaviorContractListResponse = z.infer<typeof BehaviorContractListResponseSchema>;

export const CreateBehaviorContractSchema = z.object({
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().optional(),
  triggerText: z.string().min(1).max(2000),
  commitmentBehavior: z.string().min(1).max(2000),
  fallbackPlan: z.string().min(1).max(2000),
  reviewDate: z.string(),
  accountabilityPartner: z.string().max(240).optional(),
});
export type CreateBehaviorContractDTO = z.infer<typeof CreateBehaviorContractSchema>;

export const UpdateBehaviorContractSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  triggerText: z.string().min(1).max(2000).optional(),
  commitmentBehavior: z.string().min(1).max(2000).optional(),
  fallbackPlan: z.string().min(1).max(2000).optional(),
  reviewDate: z.string().optional(),
  accountabilityPartner: z.string().max(240).nullable().optional(),
  adherenceStatus: BehaviorContractAdherenceStatusSchema.optional(),
  adherenceNote: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasMutable = value.triggerText !== undefined
    || value.commitmentBehavior !== undefined
    || value.fallbackPlan !== undefined
    || value.reviewDate !== undefined
    || value.accountabilityPartner !== undefined
    || value.adherenceStatus !== undefined
    || value.adherenceNote !== undefined
    || value.isActive !== undefined;
  if (!hasMutable) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one mutable field must be provided',
      path: ['expectedLockVersion'],
    });
  }
});
export type UpdateBehaviorContractDTO = z.infer<typeof UpdateBehaviorContractSchema>;

export const RoutineConditionKindSchema = z.enum([
  'anxiety_gte',
  'mood_lte',
  'sleep_hours_lte',
  'manual_signal',
  'custom',
]);
export type RoutineConditionKind = z.infer<typeof RoutineConditionKindSchema>;

export const RoutineActionKindSchema = z.enum([
  'open_grounding_card',
  'open_micro_learning_card',
  'start_breathing_exercise',
  'call_support_line',
  'create_clinician_task',
  'show_coping_plan',
]);
export type RoutineActionKind = z.infer<typeof RoutineActionKindSchema>;

export const RoutinePlanSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(240),
  conditionKind: RoutineConditionKindSchema,
  conditionThreshold: z.number().nullable().optional(),
  conditionWindowMinutes: z.number().int().min(1).max(24 * 60),
  thenActionKind: RoutineActionKindSchema,
  thenActionText: z.string().min(1).max(2000),
  fallbackAfterMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  fallbackActionText: z.string().max(2000).nullable().optional(),
  reviewDate: z.string(),
  isActive: z.boolean(),
  lockVersion: z.number().int().nonnegative(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RoutinePlan = z.infer<typeof RoutinePlanSchema>;

export const RoutinePlanListResponseSchema = z.object({
  routines: z.array(RoutinePlanSchema),
});
export type RoutinePlanListResponse = z.infer<typeof RoutinePlanListResponseSchema>;

export const CreateRoutinePlanSchema = z.object({
  patientId: z.string().uuid(),
  pathwayId: z.string().uuid().optional(),
  name: z.string().min(1).max(240),
  conditionKind: RoutineConditionKindSchema,
  conditionThreshold: z.number().optional().nullable(),
  conditionWindowMinutes: z.number().int().min(1).max(24 * 60).default(60),
  thenActionKind: RoutineActionKindSchema,
  thenActionText: z.string().min(1).max(2000),
  fallbackAfterMinutes: z.number().int().min(1).max(24 * 60).optional().nullable(),
  fallbackActionText: z.string().max(2000).optional().nullable(),
  reviewDate: z.string(),
  isActive: z.boolean().default(true),
});
export type CreateRoutinePlanDTO = z.infer<typeof CreateRoutinePlanSchema>;

export const UpdateRoutinePlanSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  name: z.string().min(1).max(240).optional(),
  conditionKind: RoutineConditionKindSchema.optional(),
  conditionThreshold: z.number().nullable().optional(),
  conditionWindowMinutes: z.number().int().min(1).max(24 * 60).optional(),
  thenActionKind: RoutineActionKindSchema.optional(),
  thenActionText: z.string().min(1).max(2000).optional(),
  fallbackAfterMinutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
  fallbackActionText: z.string().max(2000).nullable().optional(),
  reviewDate: z.string().optional(),
  isActive: z.boolean().optional(),
}).superRefine((value, ctx) => {
  const hasMutable = value.name !== undefined
    || value.conditionKind !== undefined
    || value.conditionThreshold !== undefined
    || value.conditionWindowMinutes !== undefined
    || value.thenActionKind !== undefined
    || value.thenActionText !== undefined
    || value.fallbackAfterMinutes !== undefined
    || value.fallbackActionText !== undefined
    || value.reviewDate !== undefined
    || value.isActive !== undefined;
  if (!hasMutable) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one mutable field must be provided',
      path: ['expectedLockVersion'],
    });
  }
});
export type UpdateRoutinePlanDTO = z.infer<typeof UpdateRoutinePlanSchema>;

export const RoutineEventTypeSchema = z.enum([
  'medication_taken',
  'sleep_logged',
  'journal_completed',
  'walk_done',
  'module_opened',
  'routine_triggered',
  'routine_completed',
  'routine_fallback_triggered',
]);
export type RoutineEventType = z.infer<typeof RoutineEventTypeSchema>;

export const RecordRoutineEventSchema = z.object({
  patientId: z.string().uuid(),
  routineId: z.string().uuid().optional(),
  eventType: RoutineEventTypeSchema,
  valueNumeric: z.number().optional(),
  valueText: z.string().max(500).optional(),
  occurredAt: z.string().datetime().optional(),
});
export type RecordRoutineEventDTO = z.infer<typeof RecordRoutineEventSchema>;

export const RecoveryStreakItemSchema = z.object({
  eventType: RoutineEventTypeSchema,
  currentStreakDays: z.number().int().nonnegative(),
  lastCompletedAt: z.string().datetime().nullable().optional(),
});
export type RecoveryStreakItem = z.infer<typeof RecoveryStreakItemSchema>;

export const RecoveryStreakSummarySchema = z.object({
  patientId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  items: z.array(RecoveryStreakItemSchema),
});
export type RecoveryStreakSummary = z.infer<typeof RecoveryStreakSummarySchema>;

export const FrictionRadarItemSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(240),
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  count: z.number().int().nonnegative(),
  lastSeenAt: z.string().datetime().nullable().optional(),
  suggestedAction: z.string().max(500),
});
export type FrictionRadarItem = z.infer<typeof FrictionRadarItemSchema>;

export const FrictionRadarResponseSchema = z.object({
  patientId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  items: z.array(FrictionRadarItemSchema),
});
export type FrictionRadarResponse = z.infer<typeof FrictionRadarResponseSchema>;

export const EscalationSlaBoardItemSchema = z.object({
  queueType: z.enum(['task', 'referral']),
  id: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  ownerStaffId: z.string().uuid().nullable().optional(),
  status: z.string().min(1),
  priority: z.string().min(1),
  openedAt: z.string().datetime(),
  slaTargetAt: z.string().datetime(),
  warningAt: z.string().datetime(),
  remainingSeconds: z.number().int(),
  isBreached: z.boolean(),
});
export type EscalationSlaBoardItem = z.infer<typeof EscalationSlaBoardItemSchema>;

export const EscalationSlaBoardResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  items: z.array(EscalationSlaBoardItemSchema),
});
export type EscalationSlaBoardResponse = z.infer<typeof EscalationSlaBoardResponseSchema>;

export const BehavioralSegmentCodeSchema = z.enum([
  'motivated',
  'ambivalent',
  'avoidant',
  'overwhelmed',
  'externally_supported',
  'resistant',
]);
export type BehavioralSegmentCode = z.infer<typeof BehavioralSegmentCodeSchema>;

export const BehavioralSegmentSchema = z.object({
  patientId: z.string().uuid(),
  segment: BehavioralSegmentCodeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string().min(1).max(500)),
  computedAt: z.string().datetime(),
  overrideByStaffId: z.string().uuid().nullable().optional(),
  overrideReason: z.string().max(500).nullable().optional(),
});
export type BehavioralSegment = z.infer<typeof BehavioralSegmentSchema>;

export const SetBehavioralSegmentOverrideSchema = z.object({
  segment: BehavioralSegmentCodeSchema,
  confidence: z.number().min(0).max(1).optional().default(0.95),
  overrideReason: z.string().min(5).max(500),
});
export type SetBehavioralSegmentOverrideDTO = z.infer<typeof SetBehavioralSegmentOverrideSchema>;

export const MicroLearningCardSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  body: z.string().min(1).max(6000),
  estimatedMinutes: z.number().int().min(1).max(120),
  tags: z.array(z.string().min(1).max(80)),
  isActive: z.boolean(),
});
export type MicroLearningCard = z.infer<typeof MicroLearningCardSchema>;

export const MicroLearningRuleSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().min(1).max(240),
  trackingType: z.enum(['anxiety', 'mood', 'sleep_hours']),
  deltaThreshold: z.number(),
  windowDays: z.number().int().min(1).max(30),
  cardId: z.string().uuid(),
  cooldownDays: z.number().int().min(1).max(60),
  isActive: z.boolean(),
  lockVersion: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MicroLearningRule = z.infer<typeof MicroLearningRuleSchema>;

export const CreateMicroLearningRuleSchema = z.object({
  name: z.string().min(1).max(240),
  trackingType: z.enum(['anxiety', 'mood', 'sleep_hours']),
  deltaThreshold: z.number(),
  windowDays: z.number().int().min(1).max(30).default(3),
  cardId: z.string().uuid(),
  cooldownDays: z.number().int().min(1).max(60).default(7),
  isActive: z.boolean().default(true),
});
export type CreateMicroLearningRuleDTO = z.infer<typeof CreateMicroLearningRuleSchema>;

export const UpdateMicroLearningRuleSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  name: z.string().min(1).max(240).optional(),
  trackingType: z.enum(['anxiety', 'mood', 'sleep_hours']).optional(),
  deltaThreshold: z.number().optional(),
  windowDays: z.number().int().min(1).max(30).optional(),
  cardId: z.string().uuid().optional(),
  cooldownDays: z.number().int().min(1).max(60).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateMicroLearningRuleDTO = z.infer<typeof UpdateMicroLearningRuleSchema>;

export const MicroLearningAssignmentSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  cardId: z.string().uuid(),
  ruleId: z.string().uuid().nullable().optional(),
  status: z.enum(['assigned', 'opened', 'completed']),
  assignedAt: z.string().datetime(),
  openedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  sourceReason: z.string().max(1000).nullable().optional(),
});
export type MicroLearningAssignment = z.infer<typeof MicroLearningAssignmentSchema>;

export const MicroLearningAssignmentListResponseSchema = z.object({
  assignments: z.array(MicroLearningAssignmentSchema),
});
export type MicroLearningAssignmentListResponse = z.infer<typeof MicroLearningAssignmentListResponseSchema>;

export const ChoiceArchitectureDefaultsSchema = z.object({
  clinicId: z.string().uuid(),
  nextReviewDueDaysDefault: z.number().int().min(1).max(365),
  safetyPlanRefreshDaysDefault: z.number().int().min(1).max(365),
  medicationReminderWindowMinutes: z.number().int().min(5).max(24 * 60),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChoiceArchitectureDefaults = z.infer<typeof ChoiceArchitectureDefaultsSchema>;

export const UpdateChoiceArchitectureDefaultsSchema = z.object({
  nextReviewDueDaysDefault: z.number().int().min(1).max(365).optional(),
  safetyPlanRefreshDaysDefault: z.number().int().min(1).max(365).optional(),
  medicationReminderWindowMinutes: z.number().int().min(5).max(24 * 60).optional(),
}).refine(
  (value) => value.nextReviewDueDaysDefault !== undefined
    || value.safetyPlanRefreshDaysDefault !== undefined
    || value.medicationReminderWindowMinutes !== undefined,
  { message: 'At least one field must be provided' },
);
export type UpdateChoiceArchitectureDefaultsDTO = z.infer<typeof UpdateChoiceArchitectureDefaultsSchema>;
