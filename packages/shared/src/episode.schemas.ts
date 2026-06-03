import z from 'zod';

export const EpisodeStatus = z.enum(['open', 'closed', 'onhold']);

export const CreateEpisodeSchema = z.object({
  patientId: z.string().uuid(),
  title: z.string().min(1),
  episodeType: z.string().optional(),
  primaryDiagnosis: z.string().optional(),
  diagnoses: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: EpisodeStatus.optional(),
  summary: z.string().optional(),
});

export type CreateEpisodeDTO = z.infer<typeof CreateEpisodeSchema>;

export const UpdateEpisodeSchema = CreateEpisodeSchema.partial().extend({
  // BUG-371c — OPTIONAL expectedLockVersion per asymmetric posture
  // (REQUIRED for prescriptions/medications, OPTIONAL for episodes —
  // transition strategy; tightening tracked in BUG-371-FOLLOWUP-3).
  // When provided: helper enforces conflict-detect 409. When absent:
  // legacy non-locking path with structured pino warn so the
  // observability gap is visible during the transition window.
  expectedLockVersion: z.number().int().positive().optional(),
});
export type UpdateEpisodeDTO = z.infer<typeof UpdateEpisodeSchema>;

export const EpisodeSearchSchema = z.object({
  status: EpisodeStatus.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export type EpisodeSearchDTO = z.infer<typeof EpisodeSearchSchema>;

export const EpisodeResponseSchema = z.object({
  id: z.string().uuid(),
  // BUG-371c — opt-lock version. OPTIONAL per asymmetric posture
  // (legacy clients tolerate the field being absent; new clients
  // echo back as expectedLockVersion).
  lockVersion: z.number().int().positive().optional(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeNumber: z.string().optional(),
  title: z.string(),
  episodeType: z.string().optional(),
  status: EpisodeStatus,
  primaryDiagnosis: z.string().optional(),
  diagnoses: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  closureReason: z.string().optional(),
  dischargeSummary: z.string().optional(),
  summary: z.string().optional(),
  team: z.string().optional(),
  teamName: z.string().optional(),
  primaryClinicianName: z.string().optional(),
  createdById: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EpisodeResponse = z.infer<typeof EpisodeResponseSchema>;

export const EpisodeListResponseSchema = z.object({
  data: z.array(EpisodeResponseSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type EpisodeListResponse = z.infer<typeof EpisodeListResponseSchema>;

export const CloseEpisodeSchema = z.object({
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  closureReason: z.string().optional(),
  dischargeSummary: z.string().optional(),
  // BUG-371c — OPTIONAL expectedLockVersion. When provided, the close
  // path conflict-detects against concurrent edits; when absent, the
  // legacy non-locking path runs with a structured warn-log.
  expectedLockVersion: z.number().int().positive().optional(),
});

export type CloseEpisodeDTO = z.infer<typeof CloseEpisodeSchema>;

export const DischargeSummarySubmitSchema = z.object({
  content: z.string().optional(),
  consultantId: z.string().uuid(),
});
export type DischargeSummarySubmitDTO = z.infer<typeof DischargeSummarySubmitSchema>;

export const DischargeSummarySignSchema = z.object({
  signature: z.string().optional().nullable(),
});
export type DischargeSummarySignDTO = z.infer<typeof DischargeSummarySignSchema>;

export const CloseWithVettingSchema = z.object({
  closureReason: z.string().max(2000).optional(),
  consultantId: z.string().uuid(),
});
export type CloseWithVettingDTO = z.infer<typeof CloseWithVettingSchema>;

export const CloseSignSchema = z.object({
  signature: z.string().optional().nullable(),
});
export type CloseSignDTO = z.infer<typeof CloseSignSchema>;