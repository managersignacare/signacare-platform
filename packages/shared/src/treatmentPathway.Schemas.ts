import { z } from 'zod';

export const CreateTreatmentPathwaySchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  pathwayType: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  status: z.enum(['active', 'completed', 'discontinued', 'paused']).default('active'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  totalSessions: z.number().int().positive().optional(),
  completedSessions: z.number().int().min(0).optional(),
  milestones: z.array(z.record(z.unknown())).optional(),
  notes: z.string().max(5000).optional(),
});
export type CreateTreatmentPathwayDTO = z.infer<typeof CreateTreatmentPathwaySchema>;

/**
 * BUG-402 — REQUIRED expectedLockVersion at the Zod boundary.
 *
 * Asymmetric posture rationale: episodes (BUG-371c) shipped OPTIONAL+warn
 * because legacy mobile clients exist with no echo path. Treatment-pathway
 * has only 2 web mutators (PathwaysTab, PathwaysPage) and zero
 * mobile/external clients — atomic REQUIRED flip is safe and removes the
 * silent-stale-write class outright.
 *
 * R-FIX-BUG-402-ZOD-REQUIRED
 */
const TreatmentPathwayPatchFields = CreateTreatmentPathwaySchema
  .partial()
  .omit({ patientId: true });
export const UpdateTreatmentPathwaySchema = TreatmentPathwayPatchFields.extend({
  expectedLockVersion: z.number().int().positive(),
  // Frontend sends snake_case fields for milestones-derived data; accepted
  // for backward compatibility with the inline route handler that
  // unpacked these fields into the JSONB.
  completed_sessions: z.number().int().min(0).optional(),
  end_date: z.string().optional(),
});
export type UpdateTreatmentPathwayDTO = z.infer<typeof UpdateTreatmentPathwaySchema>;

/**
 * BUG-402 — record-session DTO. expectedLockVersion REQUIRED so two
 * concurrent +1 mutations cannot both win.
 *
 * R-FIX-BUG-402-ZOD-REQUIRED
 */
export const RecordSessionSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
});
export type RecordSessionDTO = z.infer<typeof RecordSessionSchema>;

/**
 * BUG-402 — canonical response shape with REQUIRED lockVersion echo.
 * Clients must read this and pass it back as expectedLockVersion on the
 * next mutation.
 */
export const TreatmentPathwayResponseSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  pathwayType: z.string(),
  pathwayName: z.string(),
  status: z.enum(['active', 'completed', 'discontinued', 'paused']),
  totalSessions: z.number().int().min(0),
  completedSessions: z.number().int().min(0),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  clinicianName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lockVersion: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TreatmentPathwayResponse = z.infer<typeof TreatmentPathwayResponseSchema>;

export const PathwayInterventionTemplateKeySchema = z.enum([
  'cbt_homework',
  'dbt_skills',
  'sleep_hygiene_journey',
  'thought_diary_journey',
]);
export type PathwayInterventionTemplateKey = z.infer<typeof PathwayInterventionTemplateKeySchema>;

export const PathwayInterventionItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(240),
  description: z.string().min(1).max(2000),
  completed: z.boolean(),
  completedAt: z.string().datetime().nullable().optional(),
});
export type PathwayInterventionItem = z.infer<typeof PathwayInterventionItemSchema>;

export const PathwayInterventionPackSchema = z.object({
  id: z.string().uuid(),
  templateKey: PathwayInterventionTemplateKeySchema,
  title: z.string().min(1).max(240),
  status: z.enum(['active', 'completed']),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  assignedAt: z.string().datetime(),
  assignedByStaffId: z.string().uuid(),
  items: z.array(PathwayInterventionItemSchema),
});
export type PathwayInterventionPack = z.infer<typeof PathwayInterventionPackSchema>;

export const AssignPathwayInterventionSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  templateKey: PathwayInterventionTemplateKeySchema,
  title: z.string().min(1).max(240).optional(),
  dueDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
export type AssignPathwayInterventionDTO = z.infer<typeof AssignPathwayInterventionSchema>;

export const UpdatePathwayInterventionItemSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  completed: z.boolean().default(true),
});
export type UpdatePathwayInterventionItemDTO = z.infer<typeof UpdatePathwayInterventionItemSchema>;

export const PathwayThoughtDiaryEntrySchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  situation: z.string(),
  automaticThought: z.string(),
  emotion: z.string(),
  emotionIntensity: z.number().int().min(0).max(100),
  evidenceFor: z.string().nullable().optional(),
  evidenceAgainst: z.string().nullable().optional(),
  balancedThought: z.string().nullable().optional(),
  behaviourPlan: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  createdByStaffId: z.string().uuid(),
});
export type PathwayThoughtDiaryEntry = z.infer<typeof PathwayThoughtDiaryEntrySchema>;

export const CreatePathwayThoughtDiaryEntrySchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  occurredAt: z.string().datetime().optional(),
  situation: z.string().min(1).max(2000),
  automaticThought: z.string().min(1).max(2000),
  emotion: z.string().min(1).max(120),
  emotionIntensity: z.number().int().min(0).max(100),
  evidenceFor: z.string().max(2000).optional(),
  evidenceAgainst: z.string().max(2000).optional(),
  balancedThought: z.string().max(2000).optional(),
  behaviourPlan: z.string().max(2000).optional(),
});
export type CreatePathwayThoughtDiaryEntryDTO = z.infer<typeof CreatePathwayThoughtDiaryEntrySchema>;

const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Expected 24h HH:MM');

export const PathwaySleepHygieneCheckInSchema = z.object({
  id: z.string().uuid(),
  date: z.string(),
  bedtime: z.string().nullable().optional(),
  wakeTime: z.string().nullable().optional(),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  sleepQuality: z.number().int().min(1).max(5),
  caffeineAfterNoon: z.boolean(),
  screenAfterBed: z.boolean(),
  exerciseDone: z.boolean(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  createdByStaffId: z.string().uuid(),
});
export type PathwaySleepHygieneCheckIn = z.infer<typeof PathwaySleepHygieneCheckInSchema>;

export const CreatePathwaySleepHygieneCheckInSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  date: z.string().optional(),
  bedtime: LocalTimeSchema.optional(),
  wakeTime: LocalTimeSchema.optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  sleepQuality: z.number().int().min(1).max(5),
  caffeineAfterNoon: z.boolean(),
  screenAfterBed: z.boolean(),
  exerciseDone: z.boolean(),
  notes: z.string().max(2000).optional(),
});
export type CreatePathwaySleepHygieneCheckInDTO = z.infer<typeof CreatePathwaySleepHygieneCheckInSchema>;

export const PathwayDigitalInterventionBundleSchema = z.object({
  pathwayId: z.string().uuid(),
  lockVersion: z.number().int().nonnegative(),
  packs: z.array(PathwayInterventionPackSchema),
  thoughtDiaryEntries: z.array(PathwayThoughtDiaryEntrySchema),
  sleepJourneyCheckIns: z.array(PathwaySleepHygieneCheckInSchema),
});
export type PathwayDigitalInterventionBundle = z.infer<typeof PathwayDigitalInterventionBundleSchema>;
