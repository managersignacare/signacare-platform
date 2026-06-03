// packages/shared/src/surgery.schemas.ts
//
// Multi-specialty Phase 7 — Surgery: shared DTOs.
//
// Four resources (all case-scoped except the root surgical_cases):
//
//   - surgical_cases     (the case record — procedure, surgeon,
//                         planned date, ASA class, consent state)
//   - safety_checklists  (WHO three-phase: sign_in / time_out /
//                         sign_out; one row per phase per case)
//   - op_notes           (operative note — indication, findings,
//                         procedure, complications, EBL, specimens)
//   - pacu_records       (recovery observations — vitals, Aldrete
//                         score, discharge criteria)
//
// The op-note endpoint enforces "all three checklist phases must
// exist for this case before an op-note can be written" — a
// repository-level safeguard the original plan called out
// explicitly.
import { z } from 'zod';

// ── Surgical cases ────────────────────────────────────────────────────────

export const SurgicalUrgencyEnum = z.enum(['elective', 'urgent', 'emergency']);
export type SurgicalUrgency = z.infer<typeof SurgicalUrgencyEnum>;

export const ConsentStatusEnum = z.enum(['pending', 'signed', 'withdrawn']);
export type ConsentStatus = z.infer<typeof ConsentStatusEnum>;

export const SurgicalCaseStatusEnum = z.enum([
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);
export type SurgicalCaseStatus = z.infer<typeof SurgicalCaseStatusEnum>;

export const CreateSurgicalCaseSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  procedureCode: z.string().min(1).max(50),
  procedureDisplay: z.string().min(1).max(500),
  primarySurgeonId: z.string().uuid().nullable().optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  urgency: SurgicalUrgencyEnum,
  // ASA 1-6 per ASA physical status classification.
  asaClass: z.number().int().min(1).max(6),
  consentStatus: ConsentStatusEnum.optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateSurgicalCaseDTO = z.infer<typeof CreateSurgicalCaseSchema>;

export const SurgicalCaseResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable(),
  procedureCode: z.string(),
  procedureDisplay: z.string(),
  primarySurgeonId: z.string().uuid().nullable(),
  primarySurgeonName: z.string().nullable().optional(),
  plannedDate: z.string(),
  urgency: SurgicalUrgencyEnum,
  asaClass: z.number().int(),
  consentStatus: ConsentStatusEnum,
  status: SurgicalCaseStatusEnum,
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SurgicalCaseResponse = z.infer<typeof SurgicalCaseResponseSchema>;

// ── Safety checklists ─────────────────────────────────────────────────────

export const ChecklistPhaseEnum = z.enum(['sign_in', 'time_out', 'sign_out']);
export type ChecklistPhase = z.infer<typeof ChecklistPhaseEnum>;

/**
 * Free-form item list. Each row captures one prompt from the WHO
 * Surgical Safety Checklist plus a completion bool. JSONB so
 * clinic-level customisation (local anaesthesia prompts, etc.)
 * doesn't need a schema change.
 */
export const ChecklistItemSchema = z.object({
  prompt: z.string().min(1).max(200),
  completed: z.boolean(),
  note: z.string().max(500).nullable().optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CreateSafetyChecklistSchema = z.object({
  caseId: z.string().uuid(),
  phase: ChecklistPhaseEnum,
  items: z.array(ChecklistItemSchema).min(1),
});
export type CreateSafetyChecklistDTO = z.infer<typeof CreateSafetyChecklistSchema>;

export const SafetyChecklistResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  caseId: z.string().uuid(),
  phase: ChecklistPhaseEnum,
  items: z.array(ChecklistItemSchema),
  completedBy: z.string().uuid().nullable(),
  completedByName: z.string().nullable().optional(),
  completedAt: z.string(),
  createdAt: z.string(),
});
export type SafetyChecklistResponse = z.infer<typeof SafetyChecklistResponseSchema>;

// ── Operative notes ───────────────────────────────────────────────────────

export const OpNoteSpecimenSchema = z.object({
  label: z.string().min(1).max(200),
  destination: z.string().max(200).optional(),
});
export type OpNoteSpecimen = z.infer<typeof OpNoteSpecimenSchema>;

export const CreateOpNoteSchema = z.object({
  caseId: z.string().uuid(),
  indication: z.string().min(1).max(2000),
  findings: z.string().min(1).max(4000),
  procedureText: z.string().min(1).max(8000),
  complications: z.string().max(4000).nullable().optional(),
  estimatedBloodLossMl: z.number().int().min(0).max(100000).nullable().optional(),
  specimens: z.array(OpNoteSpecimenSchema).optional(),
});
export type CreateOpNoteDTO = z.infer<typeof CreateOpNoteSchema>;

export const OpNoteResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  caseId: z.string().uuid(),
  indication: z.string(),
  findings: z.string(),
  procedureText: z.string(),
  complications: z.string().nullable(),
  estimatedBloodLossMl: z.number().int().nullable(),
  specimens: z.array(OpNoteSpecimenSchema),
  closedBy: z.string().uuid().nullable(),
  closedByName: z.string().nullable().optional(),
  closedAt: z.string(),
});
export type OpNoteResponse = z.infer<typeof OpNoteResponseSchema>;

// ── PACU records ──────────────────────────────────────────────────────────

export const PacuVitalsSchema = z.object({
  hr: z.number().int().nullable().optional(),
  bpSystolic: z.number().int().nullable().optional(),
  bpDiastolic: z.number().int().nullable().optional(),
  spo2: z.number().int().nullable().optional(),
  temperatureC: z.number().nullable().optional(),
  respiratoryRate: z.number().int().nullable().optional(),
});
export type PacuVitals = z.infer<typeof PacuVitalsSchema>;

export const CreatePacuRecordSchema = z.object({
  caseId: z.string().uuid(),
  vitals: PacuVitalsSchema,
  // Aldrete score 0-10; ≥9 is the typical PACU discharge threshold.
  aldreteScore: z.number().int().min(0).max(10),
  dischargeCriteriaMet: z.boolean(),
  recoveryEndAt: z.string().datetime().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreatePacuRecordDTO = z.infer<typeof CreatePacuRecordSchema>;

export const PacuRecordResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  caseId: z.string().uuid(),
  vitals: PacuVitalsSchema,
  aldreteScore: z.number().int(),
  dischargeCriteriaMet: z.boolean(),
  recoveryEndAt: z.string().nullable(),
  note: z.string().nullable(),
  recordedBy: z.string().uuid().nullable(),
  recordedByName: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type PacuRecordResponse = z.infer<typeof PacuRecordResponseSchema>;
