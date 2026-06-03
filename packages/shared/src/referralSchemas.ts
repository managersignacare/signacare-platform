// packages/shared/src/referralSchemas.ts
import z from 'zod';
import { SpecialtyTypeEnum } from './specialty.schemas';

// ── FHIR-aligned two-status model (Phase 1) ────────────────────────────────
// ServiceRequest.status: is the REQUEST (the clinical intent) still active?
// Task.status:           how far has the coordinator's work on it progressed?
// These are orthogonal to the business `status` field, which captures the
// pre-existing referral lifecycle (received / under_review / accepted / …).
export const ServiceRequestStatusSchema = z.enum([
  'draft',
  'active',
  'revoked',
  'completed',
]);
export type ServiceRequestStatus = z.infer<typeof ServiceRequestStatusSchema>;

export const ReferralTaskStatusSchema = z.enum([
  'requested',
  'received',
  'accepted',
  'rejected',
  'in_progress',
  'completed',
]);
export type ReferralTaskStatus = z.infer<typeof ReferralTaskStatusSchema>;

export const ReferralUrgencySchema = z.enum([
  'emergency',
  'urgent',
  'soon',
  'routine',
]);

/**
 * Canonical source marker for outbound referrals created from the
 * "Referral Out" surface.
 */
export const OUTBOUND_REFERRAL_SOURCE = 'internal_outbound' as const;

export const ReferralDirectionSchema = z.enum(['intake', 'outbound']);
export type ReferralDirection = z.infer<typeof ReferralDirectionSchema>;

export const ReferralStatusSchema = z.enum([
  'received',
  'under_review',
  'discussed',
  'accepted',
  'rejected',
  'redirected',
  'info_requested',
  'appointment_booked',
  'expired',
  'awaiting_clinician_confirmation',
  // Solo & Team module statuses
  'pending_clinician_review',
  'pending_broadcast',
  'closed_no_response',
]);

export const ReferralModeSchema = z.enum(['standard', 'solo', 'team']);
export type ReferralMode = z.infer<typeof ReferralModeSchema>;

export const DistributionModeSchema = z.enum(['specific_clinician', 'specialty', 'all']);
export type DistributionMode = z.infer<typeof DistributionModeSchema>;

export const CreateReferralSchema = z.object({
  patientId: z.string().uuid().optional(),

  // quick registration fields if patient not yet in system
  patientGivenName: z.string().min(1).optional(),
  patientFamilyName: z.string().min(1).optional(),
  patientDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  patientPhone: z.string().max(30).optional(),
  // Optional identity enrichers for safer intake matching/quick-registration.
  // These are not required, but when present they participate in duplicate
  // detection and reduce wrong-patient risk on referral intake.
  patientMedicareNumber: z.string().max(30).optional(),
  patientMedicareIrn: z.string().max(10).optional(),
  patientIhi: z.string().max(30).optional(),
  patientDvaNumber: z.string().max(30).optional(),

  referralDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().max(50).optional(),
  fromService: z.string().min(1).max(200),
  fromProviderName: z.string().max(200).optional(),
  fromProviderPhone: z.string().max(20).optional(),
  fromProviderEmail: z.string().email().max(200).optional(),
  fromProviderPrescriberNo: z.string().max(20).optional(),
  referringOrg: z.string().max(200).optional(),
  reason: z.string().min(1),
  urgency: ReferralUrgencySchema,
  clinicalSummary: z.string().optional(),
  currentMedications: z.string().optional(),
  diagnosisInfo: z.string().optional(),
  notes: z.string().optional(),
  assignedToStaffId: z.string().uuid().optional(),
  slaDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  // Solo & Team module fields (auto-set by backend based on active module)
  referralMode: ReferralModeSchema.optional(),
  targetClinicianId: z.string().uuid().optional(),
  distributionMode: DistributionModeSchema.optional(),
  distributionSpeciality: z.string().max(100).optional(),

  // Multi-specialty Phase 1: the target specialty. If omitted, the server
  // falls back to 'mental_health' for backwards compatibility.
  targetSpecialty: SpecialtyTypeEnum.optional(),

  // Workflow direction marker:
  // - intake: inbound intake workflow
  // - outbound: referral-out workflow
  direction: ReferralDirectionSchema.optional(),
});
export type CreateReferralDTO = z.infer<typeof CreateReferralSchema>;

export const UpdateReferralSchema = z.object({
  reason: z.string().optional(),
  urgency: ReferralUrgencySchema.optional(),
  clinicalSummary: z.string().optional(),
  currentMedications: z.string().optional(),
  diagnosisInfo: z.string().optional(),
  notes: z.string().optional(),
  assignedToStaffId: z.string().uuid().optional(),
  slaDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: ReferralStatusSchema.optional(),
});
export type UpdateReferralDTO = z.infer<typeof UpdateReferralSchema>;

export const ReferralDecisionSchema = z.object({
  // `declined` is accepted as an operator-facing synonym of `rejected`.
  // Server-side command handling canonicalises to `rejected` before persistence.
  decision: z.enum(['accepted', 'declined', 'rejected', 'redirected', 'info_requested']),
  rejectionReason: z.string().max(500).optional(),
  declineReason: z.string().max(500).optional(),
  decisionReasonCategory: z
    .enum([
      'capacity',
      'scope_mismatch',
      'insufficient_information',
      'patient_preference',
      'clinical_risk',
      'duplicate_referral',
      'other',
    ])
    .optional(),
  redirectTo: z.string().max(200).optional(),
  notes: z.string().min(1).max(5000).optional(),
  // Explicit confirmation required for terminal decision actions.
  confirmDecision: z.boolean().optional().default(false),
  createEpisode: z.boolean().optional().default(false),
  episodeType: z.string().optional(),
  assignedToStaffId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  /**
   * When true, the target team is external to the organisation (e.g. another provider).
   * Skips the mandatory care-episode creation on acceptance.
   */
  isExternalTarget: z.boolean().optional().default(false),
}).superRefine((val, ctx) => {
  const decision = val.decision === 'declined' ? 'rejected' : val.decision;
  if ((decision === 'accepted' || decision === 'rejected') && val.confirmDecision !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmDecision'],
      message: 'Decision confirmation is required for accept/decline actions.',
    });
  }
  if (decision === 'rejected') {
    const reason = (val.declineReason ?? val.rejectionReason ?? '').trim();
    if (reason.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['declineReason'],
        message: 'Decline reason is required.',
      });
    }
  }
  if (decision === 'redirected' && !(val.redirectTo ?? '').trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['redirectTo'],
      message: 'Redirect target is required when decision is redirected.',
    });
  }
});
export type ReferralDecisionDTO = z.infer<typeof ReferralDecisionSchema>;

export const ReferralListFiltersSchema = z.object({
  status: ReferralStatusSchema.array().optional(),
  urgency: ReferralUrgencySchema.array().optional(),
  direction: ReferralDirectionSchema.optional(),
  search: z.string().optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type ReferralListFilters = z.infer<typeof ReferralListFiltersSchema>;

export const ReferralAttachmentSchema = z.object({
  id: z.string().uuid(),
  referralId: z.string().uuid(),
  originalFilename: z.string(),
  mimeType: z.string(),
  fileSizeBytes: z.number(),
  storageKey: z.string(),
  category: z.string(),
  ocrStatus: z.enum(['pending', 'processing', 'done', 'failed']),
  createdAt: z.string().optional(),
  ocrResult: z.unknown().optional(),
});

export const ReferralResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  referralNumber: z.string(),
  referralDate: z.string(),
  source: z.string(),
  fromService: z.string(),
  fromProviderName: z.string().nullable().optional(),
  fromProviderPhone: z.string().nullable().optional(),
  fromProviderEmail: z.string().nullable().optional(),
  fromProviderPrescriberNo: z.string().nullable().optional(),
  referringOrg: z.string().nullable().optional(),
  reason: z.string(),
  clinicalSummary: z.string().nullable().optional(),
  currentMedications: z.string().nullable().optional(),
  diagnosisInfo: z.string().nullable().optional(),
  urgency: ReferralUrgencySchema,
  status: ReferralStatusSchema,
  statusChangedAt: z.string().nullable().optional(),
  receivedAt: z.string(),
  assignedToStaffId: z.string().uuid().nullable().optional(),
  linkedEpisodeId: z.string().uuid().nullable().optional(),
  hasAttachment: z.boolean().optional().default(false),
  ocrExtracted: z.unknown().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  redirectTo: z.string().nullable().optional(),
  slaDueDate: z.string().nullable().optional(),
  slaBreached: z.boolean().optional().default(false),
  internalNotes: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  attachments: ReferralAttachmentSchema.array(),

  // Solo & Team module fields
  referralMode: ReferralModeSchema.nullable().optional(),
  targetClinicianId: z.string().uuid().nullable().optional(),
  targetClinicianName: z.string().nullable().optional(),
  acceptedByStaffId: z.string().uuid().nullable().optional(),
  acceptedByStaffName: z.string().nullable().optional(),
  broadcastAt: z.string().nullable().optional(),
  autoCloseAt: z.string().nullable().optional(),
  clarificationNotes: z.string().nullable().optional(),
  feedbackSentAt: z.string().nullable().optional(),
  distributionMode: DistributionModeSchema.nullable().optional(),
  distributionSpeciality: z.string().nullable().optional(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdByStaffName: z.string().nullable().optional(),

  // Multi-specialty Phase 1 — FHIR split status model and coordinator fields.
  targetSpecialty: SpecialtyTypeEnum.nullable().optional(),
  serviceRequestStatus: ServiceRequestStatusSchema.nullable().optional(),
  taskStatus: ReferralTaskStatusSchema.nullable().optional(),
  coordinatorId: z.string().uuid().nullable().optional(),
  coordinatorName: z.string().nullable().optional(),
  triagedAt: z.string().nullable().optional(),
  triagedBy: z.string().uuid().nullable().optional(),

  // Intake list patient display fields (optional; present when list query
  // joins the patient table).
  patientGivenName: z.string().nullable().optional(),
  patientFamilyName: z.string().nullable().optional(),
  patientDob: z.string().nullable().optional(),
  patientUrNo: z.string().nullable().optional(),
});
export type ReferralResponse = z.infer<typeof ReferralResponseSchema>;

// ── Phase 1 coordinator queue payloads ─────────────────────────────────────

export const ReferralTriageSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type ReferralTriageDTO = z.infer<typeof ReferralTriageSchema>;

export const ReferralAssignSchema = z.object({
  assignedToStaffId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type ReferralAssignDTO = z.infer<typeof ReferralAssignSchema>;

// "Private small clinic" workflow additions — accept / decline / note
// let a coordinator (or solo clinician) shepherd a referral through the
// same queue page without opening the full referral detail view.
export const ReferralAcceptSchema = z.object({
  confirmDecision: z.literal(true, {
    errorMap: () => ({ message: 'confirmDecision=true is required for accept action.' }),
  }),
  reason: z.string().max(500).optional(),
});
export type ReferralAcceptDTO = z.infer<typeof ReferralAcceptSchema>;

export const ReferralDeclineSchema = z.object({
  confirmDecision: z.literal(true, {
    errorMap: () => ({ message: 'confirmDecision=true is required for decline action.' }),
  }),
  reason: z.string().min(1).max(500),
  decisionReasonCategory: z
    .enum([
      'capacity',
      'scope_mismatch',
      'insufficient_information',
      'patient_preference',
      'clinical_risk',
      'duplicate_referral',
      'other',
    ])
    .optional(),
});
export type ReferralDeclineDTO = z.infer<typeof ReferralDeclineSchema>;

export const ReferralNoteSchema = z.object({
  note: z.string().min(1).max(2000),
});
export type ReferralNoteDTO = z.infer<typeof ReferralNoteSchema>;

export const ReferralQueueFiltersSchema = z.object({
  specialty: SpecialtyTypeEnum.optional(),
  taskStatus: ReferralTaskStatusSchema.optional(),
  direction: ReferralDirectionSchema.optional(),
  mineOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type ReferralQueueFilters = z.infer<typeof ReferralQueueFiltersSchema>;

// ── Solo & Team module schemas ──────────────────────────────────────────────

export const OfferResponseEnum = z.enum(['pending', 'accepted', 'declined', 'expired']);

export const ReferralOfferSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  staffId: z.string().uuid(),
  staffName: z.string(),
  staffSpecialisation: z.string().nullable().optional(),
  offeredAt: z.string(),
  response: OfferResponseEnum,
  respondedAt: z.string().nullable().optional(),
  declineReason: z.string().nullable().optional(),
});
export type ReferralOffer = z.infer<typeof ReferralOfferSchema>;

export const RespondToOfferSchema = z.object({
  response: z.enum(['accepted', 'declined']),
  declineReason: z.string().optional(),
  notes: z.string().optional(),
  episodeType: z.string().optional(),
});
export type RespondToOfferDTO = z.infer<typeof RespondToOfferSchema>;

export const ClarificationRequestSchema = z.object({
  question: z.string().min(1).max(5000),
});
export type ClarificationRequestDTO = z.infer<typeof ClarificationRequestSchema>;

export const ClarificationResponseSchema = z.object({
  notes: z.string().min(1).max(10000),
});
export type ClarificationResponseDTO = z.infer<typeof ClarificationResponseSchema>;

export const ReferralFeedbackLogSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  feedbackType: z.string(),
  recipientEmail: z.string(),
  sentAt: z.string(),
  messageBody: z.string().nullable().optional(),
  sentByStaffId: z.string().uuid().nullable().optional(),
  sentByStaffName: z.string().nullable().optional(),
  deliveryStatus: z.string(),
});
export type ReferralFeedbackLog = z.infer<typeof ReferralFeedbackLogSchema>;

export const MyOffersFiltersSchema = z.object({
  response: OfferResponseEnum.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type MyOffersFilters = z.infer<typeof MyOffersFiltersSchema>;

// --- Update referral status by episode ---
export const UpdateReferralByEpisodeSchema = z.object({
  status: ReferralStatusSchema,
});
export type UpdateReferralByEpisodeDTO = z.infer<typeof UpdateReferralByEpisodeSchema>;

// --- Broadcast to clinicians ---
export const ReferralBroadcastSchema = z.object({
  distributionMode: z.string().max(100).optional(),
  distributionSpeciality: z.string().max(200).optional(),
});
export type ReferralBroadcastDTO = z.infer<typeof ReferralBroadcastSchema>;

export const ReferralOcrFieldsSchema = z.object({
  patientName: z.string().nullable().optional().optional(),
  givenName: z.string().nullable().optional().optional(),
  familyName: z.string().nullable().optional().optional(),
  dob: z.string().nullable().optional().optional(),
  medicareNumber: z.string().nullable().optional().optional(),
  referrerName: z.string().nullable().optional().optional(),
  reason: z.string().nullable().optional().optional(),
  fullText: z.string().nullable().optional().optional(),
}).passthrough();
export type ReferralOcrFields = z.infer<typeof ReferralOcrFieldsSchema>;
