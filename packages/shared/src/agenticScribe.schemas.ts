import { z } from 'zod';

export const AgenticScribeDraftUrgencySchema = z.enum(['routine', 'soon', 'urgent']);

export const AgenticScribeGenerateDraftsRequestSchema = z.object({
  patientId: z.string().uuid().optional(),
  transcript: z.string().min(20).max(120_000),
  contextNote: z.string().max(20_000).optional(),
});
export type AgenticScribeGenerateDraftsRequest = z.infer<typeof AgenticScribeGenerateDraftsRequestSchema>;

export const AgenticScribeLabOrderDraftSchema = z.object({
  draftId: z.string().uuid(),
  testName: z.string().min(1).max(255),
  urgency: AgenticScribeDraftUrgencySchema,
  rationale: z.string().min(1).max(2_000),
  sourceSnippet: z.string().min(1).max(2_000),
});
export type AgenticScribeLabOrderDraft = z.infer<typeof AgenticScribeLabOrderDraftSchema>;

export const AgenticScribeReferralDraftSchema = z.object({
  draftId: z.string().uuid(),
  specialtyOrService: z.string().min(1).max(255),
  reason: z.string().min(1).max(2_000),
  urgency: AgenticScribeDraftUrgencySchema,
  sourceSnippet: z.string().min(1).max(2_000),
});
export type AgenticScribeReferralDraft = z.infer<typeof AgenticScribeReferralDraftSchema>;

export const AgenticScribeFollowUpModeSchema = z.enum(['unspecified', 'in_person', 'telehealth', 'phone']);

export const AgenticScribeFollowUpDraftSchema = z.object({
  draftId: z.string().uuid(),
  timeframeText: z.string().min(1).max(120),
  suggestedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  appointmentType: z.string().min(1).max(120),
  mode: AgenticScribeFollowUpModeSchema,
  rationale: z.string().min(1).max(2_000),
  sourceSnippet: z.string().min(1).max(2_000),
});
export type AgenticScribeFollowUpDraft = z.infer<typeof AgenticScribeFollowUpDraftSchema>;

export const AgenticScribeDraftBundleSchema = z.object({
  labOrders: z.array(AgenticScribeLabOrderDraftSchema),
  referrals: z.array(AgenticScribeReferralDraftSchema),
  followUps: z.array(AgenticScribeFollowUpDraftSchema),
});
export type AgenticScribeDraftBundle = z.infer<typeof AgenticScribeDraftBundleSchema>;

export const AgenticScribeGenerateDraftsResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  drafts: AgenticScribeDraftBundleSchema,
  disclaimer: z.string().min(1),
});
export type AgenticScribeGenerateDraftsResponse = z.infer<typeof AgenticScribeGenerateDraftsResponseSchema>;

export const AgenticScribeTaskDraftTypeSchema = z.enum(['lab_order', 'referral', 'follow_up']);

export const AgenticScribeTaskMaterializationItemSchema = z.object({
  draftType: AgenticScribeTaskDraftTypeSchema,
  draftId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().max(4_000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

export const AgenticScribeCreateTasksRequestSchema = z.object({
  patientId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  items: z.array(AgenticScribeTaskMaterializationItemSchema).min(1).max(30),
});
export type AgenticScribeCreateTasksRequest = z.infer<typeof AgenticScribeCreateTasksRequestSchema>;

export const AgenticScribeCreateTasksResponseSchema = z.object({
  createdTasks: z.array(
    z.object({
      id: z.string().uuid(),
      draftType: AgenticScribeTaskDraftTypeSchema,
      draftId: z.string().uuid(),
      title: z.string().min(1),
    }),
  ),
});
export type AgenticScribeCreateTasksResponse = z.infer<typeof AgenticScribeCreateTasksResponseSchema>;
