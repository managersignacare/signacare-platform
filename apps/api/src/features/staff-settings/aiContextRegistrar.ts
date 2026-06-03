import { z } from 'zod'
import type { Router } from 'express'
import { requireRole } from '../../middleware/rbacMiddleware'
import { CreateAiContextSchema, ImportAiContextSchema, UpdateAiContextSchema } from '@signacare/shared'
import { AI_CONTEXT_FILES_COLUMNS } from '../../db/types/ai_context_files'

const AiContextFileResponseSchema = z.object({
  id: z.string(),
  clinicId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  content: z.string(),
  contentFormat: z.string(),
  isActive: z.boolean(),
  includeInRag: z.boolean(),
  priority: z.number(),
  tokenEstimate: z.number().nullable(),
  uploadedByStaffId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const AiContextListResponseSchema = z.object({
  files: z.array(AiContextFileResponseSchema),
})

const AiContextMutationResponseSchema = z.object({
  file: AiContextFileResponseSchema,
})

const AiContextImportResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
})

const ClinicalPolicyExportSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  ruleType: z.string(),
  parameters: z.unknown(),
  llmContext: z.string().nullable(),
  category: z.string().nullable(),
  isActive: z.boolean(),
})

const TrainingExampleExportSchema = z.object({
  feedbackType: z.string(),
  originalOutput: z.string(),
  correctedOutput: z.string(),
  rating: z.number().int(),
  comments: z.string().nullable(),
})

const ModelfileExportSchema = z.object({
  actionType: z.string(),
  modelName: z.string().nullable(),
  modelfileContent: z.string().nullable(),
  systemPrompt: z.string().nullable(),
  temperature: z.number().nullable(),
  maxTokens: z.number().nullable(),
  fewShotExamples: z.unknown().nullable(),
  ragInstructions: z.string().nullable(),
  isActive: z.boolean(),
})

const AiContextExportResponseSchema = z.object({
  exportedAt: z.string(),
  version: z.string(),
  contextFiles: z.array(AiContextFileResponseSchema),
  clinicalPolicies: z.array(ClinicalPolicyExportSchema),
  trainingExamples: z.array(TrainingExampleExportSchema),
  modelfiles: z.array(ModelfileExportSchema),
})

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
    return value
  }
  return new Date(0).toISOString()
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return value
  }
}

function mapAiContextFileRowToResponse(row: Record<string, unknown>): z.infer<typeof AiContextFileResponseSchema> {
  return {
    id: String(row.id ?? ''),
    clinicId: String(row.clinic_id ?? ''),
    title: String(row.title ?? ''),
    description: row.description == null ? null : String(row.description),
    category: String(row.category ?? 'general'),
    content: String(row.content ?? ''),
    contentFormat: String(row.content_format ?? 'text'),
    isActive: Boolean(row.is_active),
    includeInRag: row.include_in_rag !== false,
    priority: toNumberOrNull(row.priority) ?? 50,
    tokenEstimate: toNumberOrNull(row.token_estimate),
    uploadedByStaffId: row.uploaded_by_staff_id == null ? null : String(row.uploaded_by_staff_id),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function mapClinicalPolicyRowToResponse(row: Record<string, unknown>): z.infer<typeof ClinicalPolicyExportSchema> {
  return {
    name: String(row.name ?? ''),
    description: row.description == null ? null : String(row.description),
    ruleType: String(row.rule_type ?? 'review_interval'),
    // BUG-638/JSONB: canonical extraction of JSONB policy parameters.
    parameters: parseJsonish(row.parameters),
    llmContext: row.llm_context == null ? null : String(row.llm_context),
    category: row.category == null ? null : String(row.category),
    isActive: Boolean(row.is_active),
  }
}

function mapTrainingFeedbackRowToResponse(row: Record<string, unknown>): z.infer<typeof TrainingExampleExportSchema> {
  return {
    feedbackType: String(row.feedback_type ?? ''),
    originalOutput: String(row.original_output ?? ''),
    correctedOutput: String(row.corrected_output ?? ''),
    rating: toNumberOrNull(row.rating) ?? 5,
    comments: row.comments == null ? null : String(row.comments),
  }
}

function mapModelfileRowToResponse(row: Record<string, unknown>): z.infer<typeof ModelfileExportSchema> {
  return {
    actionType: String(row.action_type ?? ''),
    modelName: row.model_name == null ? null : String(row.model_name),
    modelfileContent: row.modelfile_content == null ? null : String(row.modelfile_content),
    systemPrompt: row.system_prompt == null ? null : String(row.system_prompt),
    temperature: toNumberOrNull(row.temperature),
    maxTokens: toNumberOrNull(row.max_tokens),
    fewShotExamples: row.few_shot_examples ?? null,
    ragInstructions: row.rag_instructions == null ? null : String(row.rag_instructions),
    isActive: Boolean(row.is_active),
  }
}

export function registerAiContextRoutes(staffSettingsRoutes: Router): void {
  staffSettingsRoutes.get('/ai-context', requireRole('admin', 'superadmin', 'clinician'), async (req, res, next) => {
    try {
      const { db } = await import('../../db/db')
      const rows = await db('ai_context_files')
        .where({ clinic_id: req.clinicId })
        .orderBy('priority', 'asc')
        .orderBy('title', 'asc')
      return res.json(
        AiContextListResponseSchema.parse({
          files: rows.map((row) => mapAiContextFileRowToResponse(row)),
        }),
      )
    } catch (e) { next(e) }
  })

  staffSettingsRoutes.get('/ai-context/export', requireRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const { db } = await import('../../db/db')
      const files = await db('ai_context_files').where({ clinic_id: req.clinicId }).orderBy('priority', 'asc')
      const policies = await db('clinical_policies').where({ clinic_id: req.clinicId }).orderBy('sort_order', 'asc')
      const feedback = await db('ai_training_feedback').where({ clinic_id: req.clinicId }).orderBy('created_at', 'desc').limit(500)
      const modelfiles = await db('ai_modelfiles').where({ clinic_id: req.clinicId }).orderBy('action_type', 'asc')

      return res.json(
        AiContextExportResponseSchema.parse({
          exportedAt: new Date().toISOString(),
          version: '1.0',
          contextFiles: files.map((row) => mapAiContextFileRowToResponse(row)),
          clinicalPolicies: policies.map((row) => mapClinicalPolicyRowToResponse(row)),
          trainingExamples: feedback
            .filter((row) => row.corrected_output && row.rating >= 4)
            .map((row) => mapTrainingFeedbackRowToResponse(row)),
          modelfiles: modelfiles.map((row) => mapModelfileRowToResponse(row)),
        }),
      )
    } catch (e) { next(e) }
  })

  staffSettingsRoutes.post('/ai-context/import', requireRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const { db } = await import('../../db/db')
      const { v4: uuidv4 } = await import('uuid')
      const { contextFiles, clinicalPolicies, trainingExamples, modelfiles } = ImportAiContextSchema.parse(req.body)
      let imported = 0
      if (Array.isArray(contextFiles)) {
        for (const f of contextFiles) {
          await db('ai_context_files').insert({
            id: uuidv4(), clinic_id: req.clinicId, title: f.title, description: f.description ?? null,
            category: f.category ?? 'general', content: f.content, content_format: f.contentFormat ?? 'text',
            is_active: true, include_in_rag: f.includeInRag ?? true, priority: f.priority ?? 50,
            token_estimate: Math.ceil((f.content ?? '').length / 4),
            uploaded_by_staff_id: req.user!.id, created_at: new Date(), updated_at: new Date(),
          }).onConflict().ignore()
          imported++
        }
      }
      if (Array.isArray(clinicalPolicies)) {
        for (const p of clinicalPolicies) {
          await db('clinical_policies').insert({
            id: uuidv4(), clinic_id: req.clinicId, name: p.name, description: p.description ?? null,
            rule_type: p.ruleType ?? 'review_interval',
            parameters: typeof p.parameters === 'string' ? p.parameters : JSON.stringify(p.parameters ?? {}),
            llm_context: p.llmContext ?? null, category: p.category ?? null,
            is_active: p.isActive ?? true, generates_alert: true, available_to_llm: true,
            created_at: new Date(), updated_at: new Date(),
          }).onConflict().ignore()
          imported++
        }
      }
      if (Array.isArray(trainingExamples)) {
        for (const row of trainingExamples) {
          await db('ai_training_feedback').insert({
            id: uuidv4(),
            clinic_id: req.clinicId,
            staff_id: req.user!.id,
            interaction_id: uuidv4(),
            feedback_type: row.feedbackType,
            rating: row.rating ?? 5,
            comments: row.comments ?? 'Imported from AI context bundle',
            original_output: row.originalOutput ?? '',
            corrected_output: row.correctedOutput ?? '',
            created_at: new Date(),
            updated_at: new Date(),
          })
          imported++
        }
      }
      if (Array.isArray(modelfiles)) {
        for (const row of modelfiles) {
          const existing = await db('ai_modelfiles')
            .where({ clinic_id: req.clinicId, action_type: row.actionType })
            .first('id')
          if (existing?.id) {
            await db('ai_modelfiles')
              .where({ id: existing.id, clinic_id: req.clinicId })
              .update({
                model_name: row.modelName ?? null,
                modelfile_content: row.modelfileContent ?? null,
                system_prompt: row.systemPrompt ?? null,
                temperature: row.temperature ?? 0.2,
                max_tokens: row.maxTokens ?? 4096,
                few_shot_examples: row.fewShotExamples ?? null,
                rag_instructions: row.ragInstructions ?? null,
                is_active: row.isActive ?? true,
                updated_by_staff_id: req.user!.id,
                updated_at: new Date(),
              })
          } else {
            await db('ai_modelfiles').insert({
              id: uuidv4(),
              clinic_id: req.clinicId,
              action_type: row.actionType,
              model_name: row.modelName ?? 'qwen2.5:14b',
              modelfile_content: row.modelfileContent ?? null,
              system_prompt: row.systemPrompt ?? null,
              temperature: row.temperature ?? 0.2,
              max_tokens: row.maxTokens ?? 4096,
              few_shot_examples: row.fewShotExamples ?? null,
              rag_instructions: row.ragInstructions ?? null,
              is_active: row.isActive ?? true,
              updated_by_staff_id: req.user!.id,
              created_at: new Date(),
              updated_at: new Date(),
            })
          }
          imported++
        }
      }
      return res.json(
        AiContextImportResponseSchema.parse({ imported }),
      )
    } catch (e) { next(e) }
  })

  staffSettingsRoutes.post('/ai-context', requireRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const { db } = await import('../../db/db')
      const { v4: uuidv4 } = await import('uuid')
      const { title, description, category, content, contentFormat, includeInRag, priority } = CreateAiContextSchema.parse(req.body)
      const tokenEstimate = Math.ceil((content as string).length / 4)
      const [row] = await db('ai_context_files').insert({
        id: uuidv4(),
        clinic_id: req.clinicId,
        title: title.trim(),
        description: description?.trim() ?? null,
        category: category ?? 'general',
        content: content.trim(),
        content_format: contentFormat ?? 'text',
        is_active: true,
        include_in_rag: includeInRag ?? true,
        priority: priority ?? 50,
        token_estimate: tokenEstimate,
        uploaded_by_staff_id: req.user!.id,
        created_at: new Date(),
        updated_at: new Date(),
      }).returning(AI_CONTEXT_FILES_COLUMNS)
      return res.status(201).json(
        AiContextMutationResponseSchema.parse({
          file: mapAiContextFileRowToResponse(row),
        }),
      )
    } catch (e) { next(e) }
  })

  staffSettingsRoutes.patch('/ai-context/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const { db } = await import('../../db/db')
      const body = UpdateAiContextSchema.parse(req.body)
      const patch: Record<string, unknown> = { updated_at: new Date() }
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) patch.description = body.description
      if (body.category !== undefined) patch.category = body.category
      if (body.content !== undefined) {
        patch.content = body.content
        patch.token_estimate = Math.ceil((body.content as string).length / 4)
      }
      if (body.isActive !== undefined) patch.is_active = body.isActive
      if (body.includeInRag !== undefined) patch.include_in_rag = body.includeInRag
      if (body.priority !== undefined) patch.priority = body.priority
      const [row] = await db('ai_context_files')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(patch)
        .returning(AI_CONTEXT_FILES_COLUMNS)
      return res.json(
        AiContextMutationResponseSchema.parse({
          file: mapAiContextFileRowToResponse(row),
        }),
      )
    } catch (e) { next(e) }
  })

  staffSettingsRoutes.delete('/ai-context/:id', requireRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const { db } = await import('../../db/db')
      await db('ai_context_files').where({ id: req.params.id, clinic_id: req.clinicId }).delete()
      return res.json({ ok: true })
    } catch (e) { next(e) }
  })
}
