import { z } from 'zod';
import { WearableMetricTypeSchema } from '@signacare/shared';

export const ActivateSchema = z.object({
  code: z.string().min(6).max(128),
  password: z.string().min(8).max(200),
  // Accept both ISO and AU D/M/Y entry from Viva activation form.
  dob: z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
    ])
    .optional(),
  phone: z.string().min(6).max(30),
});

export const PatientLoginSchema = z.object({
  phone: z.string().min(6).max(30),
  password: z.string().min(1).max(200),
});

const TrackingEntryShape = z.object({
  trackingType: z.string().max(40).optional(),
  type: z.string().max(40).optional(),
  value: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]),
  note: z.string().max(2000).optional(),
  recordedAt: z.string().optional(),
}).passthrough();

export const TrackingEntrySchema = TrackingEntryShape.superRefine((entry, ctx) => {
  if (!entry.trackingType && !entry.type) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'trackingType (or type) is required',
      path: ['trackingType'],
    });
  }
});

export const TrackingBatchSchema = z.object({
  entries: z.array(TrackingEntrySchema).min(1).max(100),
});

export type TrackingEntryInput = z.infer<typeof TrackingEntrySchema>;

export const SingleTrackingSchema = z.object({
  value: z.union([z.string(), z.number(), z.record(z.string(), z.unknown())]),
  note: z.string().max(2000).optional(),
}).passthrough();

export const MedReminderSchema = z.object({
  drugName: z.string().min(1).max(200),
  dose: z.string().max(100).optional(),
  instructions: z.string().max(1000).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  reminderTime: z.string().regex(/^\d{2}:\d{2}/).optional(),
  medicationId: z.string().uuid().optional(),
});

export const DocumentUploadSchema = z.object({
  title: z.string().min(1).max(200),
  docType: z.string().max(60).optional(),
  url: z.string().url().optional(),
  filePath: z.string().max(500).optional(),
});

export const TriageNumberSchema = z.object({
  triageNumber: z.string().min(3).max(30),
});

export const TriageResponseSchema = z.object({
  response: z.string().min(1).max(5000),
});

export const AlertThresholdSchema = z.object({
  trackingType: z.string().max(40),
  direction: z.enum(['above', 'below']),
  threshold: z.number(),
  consecutiveDays: z.number().int().positive().max(90).optional(),
});

export const AssessmentStartSchema = z.object({
  templateId: z.string().uuid(),
});

export const AssessmentSubmitSchema = z.object({
  totalScore: z.number().nullable().optional(),
  responses: z.record(z.string(), z.unknown()),
});

export const TaskCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().optional(),
  reminderTime: z.string().optional(),
});

export const TaskStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export const ChecklistItemCreateSchema = z.object({
  item: z.string().min(1).max(500),
  appointmentId: z.string().uuid().optional(),
  sortOrder: z.number().int().optional(),
});

export const ChecklistItemToggleSchema = z.object({
  isCompleted: z.boolean(),
});

export const PatientMessageCreateSchema = z.object({
  body: z.string().min(1).max(5000),
  subject: z.string().max(255).optional(),
  patientId: z.string().uuid().optional(),
});

export const PatientMessageReplySchema = z.object({
  body: z.string().min(1).max(5000),
});

export const RegisterDeviceSchema = z.object({
  deviceToken: z.string().min(8).max(512),
  platform: z.enum(['ios', 'android', 'web']),
});

export const SyncPreferenceSchema = z.object({
  moduleKey: z.string().min(1).max(60),
  enabled: z.boolean(),
});

export const PatientInterventionItemCompletionSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  completed: z.boolean().default(true),
});

export const PatientThoughtDiarySubmissionSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  occurredAt: z.string().optional(),
  situation: z.string().min(1).max(2000),
  automaticThought: z.string().min(1).max(2000),
  emotion: z.string().min(1).max(120),
  emotionIntensity: z.number().int().min(0).max(100),
  evidenceFor: z.string().max(2000).optional(),
  evidenceAgainst: z.string().max(2000).optional(),
  balancedThought: z.string().max(2000).optional(),
  behaviourPlan: z.string().max(2000).optional(),
});

export const PatientSleepCheckInSubmissionSchema = z.object({
  expectedLockVersion: z.number().int().positive(),
  date: z.string().optional(),
  bedtime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  wakeTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  sleepQuality: z.number().int().min(1).max(5),
  caffeineAfterNoon: z.boolean(),
  screenAfterBed: z.boolean(),
  exerciseDone: z.boolean(),
  notes: z.string().max(2000).optional(),
});

export const PatientWearableSourceCreateSchema = z.object({
  provider: z.enum([
    'apple_health',
    'google_fit',
    'fitbit',
    'garmin',
    'oura',
    'whoop',
    'manual_import',
  ]),
  deviceLabel: z.string().min(1).max(120),
  externalDeviceId: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PatientWearableIngestSchema = z.object({
  sourceId: z.string().uuid(),
  entries: z.array(z.object({
    metricType: WearableMetricTypeSchema,
    value: z.number(),
    timestamp: z.string().optional(),
    note: z.string().max(500).optional(),
  })).min(1).max(500),
});
