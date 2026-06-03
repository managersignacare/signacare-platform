import { z } from 'zod';

// --- Alert Types ---
export const CreateAlertTypeSchema = z.object({
  name: z.string().min(1).max(200),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  color: z.string().max(20).optional(),
  planTemplate: z.string().max(5000).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type CreateAlertTypeDTO = z.infer<typeof CreateAlertTypeSchema>;

export const UpdateAlertTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  color: z.string().max(20).optional(),
  planTemplate: z.string().max(5000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAlertTypeDTO = z.infer<typeof UpdateAlertTypeSchema>;

// --- Legal Order Types ---
export const CreateLegalOrderTypeSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
});
export type CreateLegalOrderTypeDTO = z.infer<typeof CreateLegalOrderTypeSchema>;

export const UpdateLegalOrderTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateLegalOrderTypeDTO = z.infer<typeof UpdateLegalOrderTypeSchema>;

// --- Appointment Modes ---
export const CreateAppointmentModeSchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateAppointmentModeDTO = z.infer<typeof CreateAppointmentModeSchema>;

export const UpdateAppointmentModeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAppointmentModeDTO = z.infer<typeof UpdateAppointmentModeSchema>;

// --- Template Categories ---
export const CreateTemplateCategorySchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateTemplateCategoryDTO = z.infer<typeof CreateTemplateCategorySchema>;

export const UpdateTemplateCategorySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
export type UpdateTemplateCategoryDTO = z.infer<typeof UpdateTemplateCategorySchema>;

// --- Clinical Templates ---
export const CreateClinicalTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(100).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  content: z.unknown().optional(),
});
export type CreateClinicalTemplateDTO = z.infer<typeof CreateClinicalTemplateSchema>;

// --- Episode Types ---
export const CreateEpisodeTypeSchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateEpisodeTypeDTO = z.infer<typeof CreateEpisodeTypeSchema>;

export const UpdateEpisodeTypeSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateEpisodeTypeDTO = z.infer<typeof UpdateEpisodeTypeSchema>;

// --- Contact Options (Outreach Config) ---
export const UpdateContactOptionsSchema = z.object({
  locations: z.array(z.string()).optional(),
  programs: z.array(z.string()).optional(),
  serviceRecipientTypes: z.array(z.string()).optional(),
  contactMediaTypes: z.array(z.string()).optional(),
});
export type UpdateContactOptionsDTO = z.infer<typeof UpdateContactOptionsSchema>;

// --- Bulk Reassign (Relocate) ---
export const BulkReassignSchema = z.object({
  type: z.enum(['clinician', 'team']),
  fromId: z.string().uuid().optional(),
  toId: z.string().uuid().optional(),
  fromTeam: z.string().uuid().optional(),
  toTeam: z.string().uuid().optional(),
  patientIds: z.array(z.string().uuid()).optional(),
});
export type BulkReassignDTO = z.infer<typeof BulkReassignSchema>;

// --- Planned Transitions (Staff Reallocation) ---
const TransitionAssignmentSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional().nullable(),
  toStaffId: z.string().uuid(),
  toTeam: z.string().uuid().optional().nullable(),
  handoverNotes: z.string().max(5000).optional().nullable(),
});

export const CreateTransitionSchema = z.object({
  fromStaffId: z.string().uuid(),
  reason: z.string().min(1).max(1000),
  effectiveDate: z.string().min(1),
  notes: z.string().max(5000).optional().nullable(),
  assignments: z.array(TransitionAssignmentSchema).optional(),
});
export type CreateTransitionDTO = z.infer<typeof CreateTransitionSchema>;

export const UpdateTransitionSchema = z.object({
  status: z.enum(['draft', 'approved', 'executed', 'cancelled']).optional(),
  notes: z.string().max(5000).optional().nullable(),
  assignments: z.array(TransitionAssignmentSchema).optional(),
});
export type UpdateTransitionDTO = z.infer<typeof UpdateTransitionSchema>;

// --- Clinical Policies ---
export const CreateClinicalPolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  ruleType: z.string().max(100).optional(),
  parameters: z.unknown().optional(),
  llmContext: z.string().max(10000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
});
export type CreateClinicalPolicyDTO = z.infer<typeof CreateClinicalPolicySchema>;

export const UpdateClinicalPolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  parameters: z.unknown().optional(),
  isActive: z.boolean().optional(),
  llmContext: z.string().max(10000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  generatesAlert: z.boolean().optional(),
  availableToLlm: z.boolean().optional(),
});
export type UpdateClinicalPolicyDTO = z.infer<typeof UpdateClinicalPolicySchema>;

// --- AI Context Files ---
export const CreateAiContextSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).optional(),
  content: z.string().min(1).max(100000),
  contentFormat: z.string().max(50).optional(),
  includeInRag: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});
export type CreateAiContextDTO = z.infer<typeof CreateAiContextSchema>;

export const UpdateAiContextSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).optional(),
  content: z.string().min(1).max(100000).optional(),
  isActive: z.boolean().optional(),
  includeInRag: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});
export type UpdateAiContextDTO = z.infer<typeof UpdateAiContextSchema>;

// --- AI Context Import ---
const ImportContextFileSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(100).optional(),
  content: z.string().min(1),
  contentFormat: z.string().max(50).optional(),
  includeInRag: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});
const ImportPolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  ruleType: z.string().max(100).optional(),
  parameters: z.unknown().optional(),
  llmContext: z.string().max(10000).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});
const ImportTrainingExampleSchema = z.object({
  feedbackType: z.string().min(1).max(100),
  originalOutput: z.string().max(200000).optional(),
  correctedOutput: z.string().max(200000).optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comments: z.string().max(10000).optional(),
});
const ImportModelfileSchema = z.object({
  actionType: z.string().min(1).max(100),
  modelName: z.string().max(200).optional().nullable(),
  modelfileContent: z.string().max(50000).optional().nullable(),
  systemPrompt: z.string().max(50000).optional().nullable(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(100000).optional(),
  fewShotExamples: z.string().max(100000).optional().nullable(),
  ragInstructions: z.string().max(50000).optional().nullable(),
  isActive: z.boolean().optional(),
});
export const ImportAiContextSchema = z.object({
  contextFiles: z.array(ImportContextFileSchema).optional(),
  clinicalPolicies: z.array(ImportPolicySchema).optional(),
  trainingExamples: z.array(ImportTrainingExampleSchema).optional(),
  modelfiles: z.array(ImportModelfileSchema).optional(),
});
export type ImportAiContextDTO = z.infer<typeof ImportAiContextSchema>;
