import { z } from 'zod';

export const AncStatusEnum = z.enum(['normal', 'amber', 'red', 'unknown']);
export const TitrationPhaseEnum = z.enum([
  'initiation',
  'maintenance',
  'tapering',
  'ceased',
]);

export const ClozapineRegistrationCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  drugProductId: z.string().uuid().optional(),
  prescriberStaffId: z.string().uuid().optional(),
  registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dispenserPharmacy: z.string().max(200).optional(),
  currentDoseMg: z.number().positive().optional(),
  titrationPhase: TitrationPhaseEnum.default('initiation'),
  monitoringFrequency: z.string().max(30).default('weekly'),
  notes: z.string().optional(),
});
export type ClozapineRegistrationCreateDTO = z.infer<typeof ClozapineRegistrationCreateSchema>;

export const ClozapineRegistrationUpdateSchema = z.object({
  dispenserPharmacy: z.string().max(200).optional(),
  currentDoseMg: z.number().positive().optional(),
  titrationPhase: TitrationPhaseEnum.optional(),
  monitoringFrequency: z.string().max(30).optional(),
  nextBloodDueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  physicalHealthCheckDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ceasedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ceasedReason: z.string().optional(),
  notes: z.string().optional(),
});
export type ClozapineRegistrationUpdateDTO = z.infer<typeof ClozapineRegistrationUpdateSchema>;

export const ClozapineRegistrationResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  drugProductId: z.string().uuid().nullable(),
  prescriberStaffId: z.string().uuid().nullable(),
  registrationDate: z.string(),
  dispenserPharmacy: z.string().nullable(),
  currentDoseMg: z.number().nullable(),
  titrationPhase: TitrationPhaseEnum,
  monitoringWeek: z.number().nullable(),
  monitoringFrequency: z.string(),
  lastAncDate: z.string().nullable(),
  lastAncValue: z.number().nullable(),
  ancStatus: AncStatusEnum,
  lastWbcDate: z.string().nullable(),
  lastWbcValue: z.number().nullable(),
  nextBloodDueDate: z.string().nullable(),
  physicalHealthCheckDue: z.string().nullable(),
  ceasedDate: z.string().nullable(),
  ceasedReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClozapineRegistrationResponse = z.infer<typeof ClozapineRegistrationResponseSchema>;

export const ClozapineBloodResultCreateSchema = z.object({
  registrationId: z.string().uuid(),
  patientId: z.string().uuid(),
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resultedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  ancValue: z.number().positive().optional(),
  wbcValue: z.number().positive().optional(),
  neutrophilsPct: z.number().min(0).max(100).optional(),
  labName: z.string().max(200).optional(),
  labReference: z.string().max(100).optional(),
  clinicalNotes: z.string().optional(),
});
export type ClozapineBloodResultCreateDTO = z.infer<typeof ClozapineBloodResultCreateSchema>;

export const ClozapineBloodResultResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  registrationId: z.string().uuid(),
  recordedByStaffId: z.string().uuid(),
  collectionDate: z.string(),
  resultedDate: z.string().nullable(),
  ancValue: z.number().nullable(),
  wbcValue: z.number().nullable(),
  neutrophilsPct: z.number().nullable(),
  ancStatus: AncStatusEnum,
  flagRaised: z.boolean(),
  flagType: z.string().nullable(),
  labName: z.string().nullable(),
  labReference: z.string().nullable(),
  clinicalNotes: z.string().nullable(),
  createdAt: z.string(),
});
export type ClozapineBloodResultResponse = z.infer<typeof ClozapineBloodResultResponseSchema>;

// ── Titration Day ────────────────────────────────────────────────────────────
export const ClozapineTitrationDayCreateSchema = z.object({
  registrationId: z.string().uuid(),
  dayNumber: z.number().int().min(1).max(100),
  titrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  morningDoseMg: z.number().min(0).optional(),
  eveningDoseMg: z.number().min(0).optional(),
  prescriberInitials: z.string().max(10).optional(),
  comments: z.string().optional(),
});
export type ClozapineTitrationDayCreateDTO = z.infer<typeof ClozapineTitrationDayCreateSchema>;

export const ClozapineTitrationDayResponseSchema = z.object({
  id: z.string().uuid(),
  registrationId: z.string().uuid(),
  dayNumber: z.number(),
  titrationDate: z.string(),
  morningDoseMg: z.number().nullable(),
  eveningDoseMg: z.number().nullable(),
  prescriberInitials: z.string().nullable(),
  prescribedByStaffId: z.string().uuid().nullable(),
  comments: z.string().nullable(),
});
export type ClozapineTitrationDayResponse = z.infer<typeof ClozapineTitrationDayResponseSchema>;

// ── Administration ───────────────────────────────────────────────────────────
export const NonAdminCodeEnum = z.enum(['A', 'F', 'R', 'V', 'L', 'N', 'W', 'S']);

export const ClozapineAdministrationCreateSchema = z.object({
  registrationId: z.string().uuid(),
  titrationDayId: z.string().uuid().optional(),
  administrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeSlot: z.enum(['morning', 'evening']),
  actualTime: z.string().max(5).optional(),
  doseMg: z.number().positive(),
  administered: z.boolean().default(true),
  nonAdminCode: NonAdminCodeEnum.optional(),
  administratorInitials: z.string().max(10).optional(),
  notes: z.string().optional(),
});
export type ClozapineAdministrationCreateDTO = z.infer<typeof ClozapineAdministrationCreateSchema>;

export const ClozapineAdministrationResponseSchema = z.object({
  id: z.string().uuid(),
  registrationId: z.string().uuid(),
  titrationDayId: z.string().uuid().nullable(),
  administrationDate: z.string(),
  timeSlot: z.enum(['morning', 'evening']),
  actualTime: z.string().nullable(),
  doseMg: z.number(),
  administered: z.boolean(),
  nonAdminCode: z.string().nullable(),
  administeredByStaffId: z.string().uuid().nullable(),
  administratorInitials: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type ClozapineAdministrationResponse = z.infer<typeof ClozapineAdministrationResponseSchema>;

// ── Observations ─────────────────────────────────────────────────────────────
export const ClozapineObservationCreateSchema = z.object({
  registrationId: z.string().uuid(),
  observationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observationTime: z.string().max(5).optional(),
  temperature: z.number().min(30).max(45).optional(),
  pulse: z.number().int().min(20).max(250).optional(),
  bpSystolicLying: z.number().int().optional(),
  bpDiastolicLying: z.number().int().optional(),
  bpSystolicStanding: z.number().int().optional(),
  bpDiastolicStanding: z.number().int().optional(),
  respirationRate: z.number().int().optional(),
  smokingStatus: z.enum(['non-smoker', 'smoker', 'recently_ceased']).optional(),
  cigarettesPerDay: z.number().int().min(0).optional(),
  outsideNormal: z.boolean().default(false),
  notes: z.string().optional(),
});
export type ClozapineObservationCreateDTO = z.infer<typeof ClozapineObservationCreateSchema>;

export const ClozapineObservationResponseSchema = z.object({
  id: z.string().uuid(),
  registrationId: z.string().uuid(),
  observationDate: z.string(),
  observationTime: z.string().nullable(),
  temperature: z.number().nullable(),
  pulse: z.number().nullable(),
  bpSystolicLying: z.number().nullable(),
  bpDiastolicLying: z.number().nullable(),
  bpSystolicStanding: z.number().nullable(),
  bpDiastolicStanding: z.number().nullable(),
  respirationRate: z.number().nullable(),
  smokingStatus: z.string().nullable(),
  cigarettesPerDay: z.number().nullable(),
  outsideNormal: z.boolean(),
  notes: z.string().nullable(),
  recordedByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ClozapineObservationResponse = z.infer<typeof ClozapineObservationResponseSchema>;

// ── Monitoring Checks ────────────────────────────────────────────────────────
export const ClozapineMonitoringCheckCreateSchema = z.object({
  registrationId: z.string().uuid(),
  investigation: z.string().max(80),
  checkPoint: z.enum(['baseline', 'day7', 'day14', 'day21', 'day28', 'ongoing']),
  checkDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  resultStatus: z.enum(['normal', 'abnormal', 'pending', 'not_required']).optional(),
  resultValue: z.string().optional(),
  notes: z.string().optional(),
});
export type ClozapineMonitoringCheckCreateDTO = z.infer<typeof ClozapineMonitoringCheckCreateSchema>;

export const ClozapineMonitoringCheckResponseSchema = z.object({
  id: z.string().uuid(),
  registrationId: z.string().uuid(),
  investigation: z.string(),
  checkPoint: z.string(),
  checkDate: z.string().nullable(),
  resultStatus: z.string().nullable(),
  resultValue: z.string().nullable(),
  notes: z.string().nullable(),
  recordedByStaffId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ClozapineMonitoringCheckResponse = z.infer<typeof ClozapineMonitoringCheckResponseSchema>;