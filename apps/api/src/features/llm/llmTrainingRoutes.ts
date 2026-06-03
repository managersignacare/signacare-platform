import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  ENTERPRISE_LLM_PROMPT_PROFILES,
  ENTERPRISE_LLM_PROMPT_PROFILES_BY_ID,
  LLM_PROMPT_PROFILE_LIBRARY_VERSION,
  PromptProfileApplyRequestSchema,
  PromptProfileApplyResponseSchema,
  PromptProfileLibraryResponseSchema,
} from '@signacare/shared';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requireFeatureEnabled } from '../../middleware/featureFlagMiddleware';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import { resolveBinary } from '../../shared/binaryResolver';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
// Ollama model name format: `[a-z0-9][a-z0-9._-]*` plus optional `:tag`.
// Enforced at the Zod layer so malformed names are rejected before any
// downstream execFile / Modelfile string.
const OLLAMA_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}(:[a-z0-9][a-z0-9._-]{0,63})?$/i;

const ModelfileUpsertSchema = z.object({
  modelName: z.string().regex(OLLAMA_NAME_RE).optional(),
  modelfileContent: z.string().max(50000).optional(),
  systemPrompt: z.string().max(50000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(100000).optional(),
  fewShotExamples: z.string().max(100000).optional(),
  ragInstructions: z.string().max(50000).optional(),
  isActive: z.boolean().optional(),
});

const RagTestQuerySchema = z.object({
  query: z.string().min(1).max(5000),
});

const TrainingStartSchema = z.object({
  baseModel: z.string().regex(OLLAMA_NAME_RE).optional(),
  adapterName: z.string().regex(OLLAMA_NAME_RE).optional(),
});

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: ai_modelfiles has these 14 columns.
const AI_MODELFILE_COLUMNS = [
  'id', 'clinic_id', 'action_type', 'model_name', 'modelfile_content',
  'system_prompt', 'temperature', 'max_tokens', 'few_shot_examples',
  'rag_instructions', 'is_active', 'updated_by_staff_id',
  'created_at', 'updated_at',
] as const;

interface RagContextFileRow {
  content?: string | null;
  title?: string | null;
  token_estimate?: number | null;
  [key: string]: unknown;
}

interface RagPolicyRow {
  name?: string | null;
  description?: string | null;
  llm_context?: string | null;
  [key: string]: unknown;
}

interface ScoredRagItem {
  relevanceScore: number;
  matchedTerms: number;
}

type ScoredRagContextFile = RagContextFileRow & ScoredRagItem;
type ScoredRagPolicy = RagPolicyRow & ScoredRagItem;

interface OllamaModelTag {
  name?: string | null;
  [key: string]: unknown;
}

type PromptProfileRow = {
  id: string;
  action_type: string;
  model_name: string;
  temperature: string | number | null;
  max_tokens: number | null;
  is_active: boolean;
  modelfile_content?: string | null;
};

function parseTokenEstimate(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseNumericOrDefault(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

const router = Router();
router.use(requireAuth);
// Audit Tier 5.1 — AI kill switch. Every training + RAG path is
// gated behind `ai-training` so an admin can halt export / local
// adapter training clinic-wide via the 2-person disable flow.
router.use(requireFeatureEnabled('ai-training'));

const ADMIN = ['admin', 'superadmin'];
const CLINICAL = ['clinician', 'admin', 'superadmin'];

// ── Model-agnostic Prompt Profiles (portable across deployments/models) ──────
router.get('/prompt-profiles', requireRoles(CLINICAL), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(PromptProfileLibraryResponseSchema.parse({
      version: LLM_PROMPT_PROFILE_LIBRARY_VERSION,
      profiles: ENTERPRISE_LLM_PROMPT_PROFILES,
    }));
  } catch (err) { next(err); }
});

router.post('/prompt-profiles/apply', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { profileIds, replaceExisting, includeManifestInContext } = PromptProfileApplyRequestSchema.parse(req.body ?? {});
    const selectedProfiles = profileIds && profileIds.length > 0
      ? profileIds.map((id) => ENTERPRISE_LLM_PROMPT_PROFILES_BY_ID[id])
      : [...ENTERPRISE_LLM_PROMPT_PROFILES];

    let upsertedActions = 0;
    let manifestRowsWritten = 0;
    const now = new Date();

    for (const profile of selectedProfiles) {
      for (const actionType of profile.targetActions) {
        const existing = await db('ai_modelfiles')
          .where({ clinic_id: req.clinicId, action_type: actionType })
          .first() as PromptProfileRow | undefined;

        if (existing) {
          await db('ai_modelfiles')
            .where({ id: existing.id, clinic_id: req.clinicId })
            .update({
              system_prompt: profile.systemPrompt,
              rag_instructions: profile.ragInstructions,
              few_shot_examples: profile.fewShotExamples,
              is_active: true,
              model_name: replaceExisting === true ? (existing.model_name || 'llama3.2') : existing.model_name,
              temperature: parseNumericOrDefault(existing.temperature, 0.2),
              max_tokens: parseNumericOrDefault(existing.max_tokens, 4096),
              updated_by_staff_id: req.user!.id,
              updated_at: now,
            });
        } else {
          await db('ai_modelfiles').insert({
            id: uuidv4(),
            clinic_id: req.clinicId,
            action_type: actionType,
            model_name: 'llama3.2',
            modelfile_content: null,
            system_prompt: profile.systemPrompt,
            temperature: 0.2,
            max_tokens: 4096,
            few_shot_examples: profile.fewShotExamples,
            rag_instructions: profile.ragInstructions,
            is_active: true,
            updated_by_staff_id: req.user!.id,
            created_at: now,
            updated_at: now,
          });
        }
        upsertedActions += 1;
      }

      if (includeManifestInContext !== false) {
        const manifestTitle = `Prompt Profile Manifest — ${profile.id}@${profile.version}`;
        const existingManifest = await db('ai_context_files')
          .where({ clinic_id: req.clinicId, title: manifestTitle, category: 'prompt_profile' })
          .first('id');
        const manifestPayload = JSON.stringify({
          profileId: profile.id,
          profileVersion: profile.version,
          libraryVersion: LLM_PROMPT_PROFILE_LIBRARY_VERSION,
          modelAgnostic: profile.modelAgnostic,
          purpose: profile.purpose,
          targetActions: profile.targetActions,
          governanceChecklist: profile.governanceChecklist,
          appliedAt: now.toISOString(),
        }, null, 2);
        if (existingManifest?.id) {
          await db('ai_context_files')
            .where({ id: existingManifest.id, clinic_id: req.clinicId })
            .update({
              content: manifestPayload,
              is_active: true,
              include_in_rag: false,
              token_estimate: Math.ceil(manifestPayload.length / 4),
              uploaded_by_staff_id: req.user!.id,
              updated_at: now,
            });
        } else {
          await db('ai_context_files').insert({
            id: uuidv4(),
            clinic_id: req.clinicId,
            title: manifestTitle,
            description: 'Portable manifest of enterprise model-agnostic prompt profile application',
            category: 'prompt_profile',
            content: manifestPayload,
            content_format: 'json',
            is_active: true,
            include_in_rag: false,
            priority: 95,
            token_estimate: Math.ceil(manifestPayload.length / 4),
            uploaded_by_staff_id: req.user!.id,
            created_at: now,
            updated_at: now,
          });
        }
        manifestRowsWritten += 1;
      }
    }

    res.json(PromptProfileApplyResponseSchema.parse({
      appliedProfileIds: selectedProfiles.map((p) => p.id),
      upsertedActions,
      manifestRowsWritten,
    }));
  } catch (err) { next(err); }
});

// ── Modelfile + System Prompt Management ─────────────────────────────────────

// GET /llm/modelfiles — list all custom modelfiles for this clinic
router.get('/modelfiles', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('ai_modelfiles')
      .where({ clinic_id: req.clinicId })
      .orderBy('action_type', 'asc');
    res.json({ modelfiles: rows });
  } catch (err) { next(err); }
});

// GET /llm/modelfiles/:actionType — get a specific modelfile
router.get('/modelfiles/:actionType', requireRoles(CLINICAL), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db('ai_modelfiles')
      .where({ clinic_id: req.clinicId, action_type: req.params.actionType })
      .first();
    res.json({ modelfile: row ?? null });
  } catch (err) { next(err); }
});

// PUT /llm/modelfiles/:actionType — upsert modelfile + prompt
router.put('/modelfiles/:actionType', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { modelName, modelfileContent, systemPrompt, temperature, maxTokens, fewShotExamples, ragInstructions, isActive } = ModelfileUpsertSchema.parse(req.body);
    const existing = await db('ai_modelfiles')
      .where({ clinic_id: req.clinicId, action_type: req.params.actionType })
      .first();

    if (existing) {
      const [row] = await db('ai_modelfiles')
        .where({ id: existing.id, clinic_id: req.clinicId })
        .update({
          model_name: modelName ?? existing.model_name,
          modelfile_content: modelfileContent ?? existing.modelfile_content,
          system_prompt: systemPrompt ?? existing.system_prompt,
          temperature: temperature ?? existing.temperature,
          max_tokens: maxTokens ?? existing.max_tokens,
          few_shot_examples: fewShotExamples ?? existing.few_shot_examples,
          rag_instructions: ragInstructions ?? existing.rag_instructions,
          is_active: isActive ?? existing.is_active,
          updated_by_staff_id: req.user!.id,
          updated_at: new Date(),
        })
        .returning(AI_MODELFILE_COLUMNS);
      res.json({ modelfile: row });
    } else {
      const [row] = await db('ai_modelfiles')
        .insert({
          id: uuidv4(),
          clinic_id: req.clinicId,
          action_type: req.params.actionType,
          model_name: modelName ?? 'qwen2.5:14b',
          modelfile_content: modelfileContent ?? null,
          system_prompt: systemPrompt ?? null,
          temperature: temperature ?? 0.2,
          max_tokens: maxTokens ?? 4096,
          few_shot_examples: fewShotExamples ?? null,
          rag_instructions: ragInstructions ?? null,
          is_active: isActive ?? true,
          updated_by_staff_id: req.user!.id,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning(AI_MODELFILE_COLUMNS);
      res.status(201).json({ modelfile: row });
    }
  } catch (err) { next(err); }
});

// DELETE /llm/modelfiles/:actionType — remove custom override (reverts to defaults)
router.delete('/modelfiles/:actionType', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await db('ai_modelfiles')
      .where({ clinic_id: req.clinicId, action_type: req.params.actionType })
      .delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── RAG Testing ──────────────────────────────────────────────────────────────

// POST /llm/rag/test-query — test what context would be retrieved for a query
router.post('/rag/test-query', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query } = RagTestQuerySchema.parse(req.body);

    // Load active context files and policies
    const files = await db<RagContextFileRow>('ai_context_files')
      .where({ clinic_id: req.clinicId, is_active: true, include_in_rag: true })
      .orderBy('priority', 'asc')
      .limit(10);

    const policies = await db<RagPolicyRow>('clinical_policies')
      .where({ clinic_id: req.clinicId, is_active: true, available_to_llm: true })
      .orderBy('sort_order', 'asc');

    // Simple keyword matching for relevance scoring
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/).filter((w: string) => w.length > 2);
    const scoredFiles: ScoredRagContextFile[] = files.map((f) => {
      const content = (f.content ?? '').toLowerCase();
      const title = (f.title ?? '').toLowerCase();
      const hits = words.filter((w: string) => content.includes(w) || title.includes(w)).length;
      return { ...f, relevanceScore: hits / Math.max(words.length, 1), matchedTerms: hits };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);

    const scoredPolicies: ScoredRagPolicy[] = policies.map((p) => {
      const text = `${p.name} ${p.description ?? ''} ${p.llm_context ?? ''}`.toLowerCase();
      const hits = words.filter((w: string) => text.includes(w)).length;
      return { ...p, relevanceScore: hits / Math.max(words.length, 1), matchedTerms: hits };
    }).sort((a, b) => b.relevanceScore - a.relevanceScore);

    const totalTokens = scoredFiles.reduce((sum: number, f) => sum + parseTokenEstimate(f.token_estimate), 0);

    res.json({
      query,
      contextFiles: scoredFiles.slice(0, 5),
      policies: scoredPolicies.slice(0, 5),
      totalTokenEstimate: totalTokens,
      totalFiles: files.length,
      totalPolicies: policies.length,
    });
  } catch (err) { next(err); }
});

// ── Fine-tuning ──────────────────────────────────────────────────────────────

// POST /llm/training/start — trigger fine-tuning via Ollama create
router.post('/training/start', requireRoles(ADMIN), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { baseModel, adapterName } = TrainingStartSchema.parse(req.body);
    const model = baseModel && baseModel.length > 0 ? baseModel : 'qwen2.5:14b';
    const rawName: string = (adapterName && adapterName.length > 0)
      ? adapterName
      : `signacare-clinic-${req.clinicId.substring(0, 8)}`;

    // Zod already enforced the Ollama-compatible name regex for the two
    // user-supplied values above (baseModel / adapterName). The fallback
    // `signacare-clinic-<uuid-prefix>` is constructed from the clinic's
    // UUID which is itself [0-9a-f]+ and therefore satisfies the same
    // regex — but we re-check defence-in-depth for the rawName in case
    // a future refactor changes the fallback.
    if (!OLLAMA_NAME_RE.test(rawName)) {
      res.status(400).json({
        error: 'adapterName must be a valid Ollama model name (alphanumeric plus . _ -, optional :tag suffix)',
        code: 'INVALID_ADAPTER_NAME',
      });
      return;
    }
    // Same defence-in-depth check on model (after fallback selection).
    if (!OLLAMA_NAME_RE.test(model)) {
      res.status(400).json({
        error: 'baseModel must be a valid Ollama model reference',
        code: 'INVALID_BASE_MODEL',
      });
      return;
    }
    const name = rawName;

    // Build Modelfile from custom config
    const config = await db('ai_modelfiles')
      .where({ clinic_id: req.clinicId, action_type: 'ambient', is_active: true })
      .first();

    const systemPrompt = config?.system_prompt ?? 'You are a clinical documentation assistant for Australian mental health services.';
    const temp = config?.temperature ?? 0.2;

    const modelfile = `FROM ${model}
PARAMETER temperature ${temp}
PARAMETER num_ctx 4096
SYSTEM """
${systemPrompt}
"""`;

    // Write Modelfile and trigger ollama create
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const modelfilePath = path.join(os.tmpdir(), `signacare-modelfile-${Date.now()}`);
    await fs.writeFile(modelfilePath, modelfile);

    try {
      // execFile with an array of args — no shell involvement, no
      // command-injection surface even before the name regex above.
      // Binary path resolved through the shared resolver so the
      // call survives macOS dev boxes where `ollama` may only be
      // in /opt/homebrew/bin and the child process PATH misses it.
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const ollamaBin = resolveBinary('ollama');
      await execFileAsync(ollamaBin, ['create', name, '-f', modelfilePath], { timeout: 120_000 });
      logger.info({ name, model }, '[AI Training] Modelfile created successfully');
      res.json({ ok: true, modelName: name, modelfile });
    } finally {
      await fs.unlink(modelfilePath).catch(err => { logger.debug({ err }, 'Model file cleanup'); });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create model';
    logger.error({ err: msg }, '[AI Training] Failed to create model');
    // BUG-275 — pass the ORIGINAL err through so its class, stack,
    // cause chain, and custom fields reach the global errorHandler.
    next(err);
  }
});

// GET /llm/training/adapters — list available custom models in Ollama
router.get('/training/adapters', requireRoles(ADMIN), async (_req: Request, res: Response, _next: NextFunction) => {
  try {
    const axios = (await import('axios')).default;
    const resp = await axios.get('http://localhost:11434/api/tags', { timeout: 5000 });
    const modelsRaw: unknown = resp.data?.models;
    const models: OllamaModelTag[] = Array.isArray(modelsRaw)
      ? modelsRaw.filter((m): m is OllamaModelTag => !!m && typeof m === 'object')
      : [];
    const customModels = models.filter((m) => typeof m.name === 'string' && m.name.includes('signacare-'));
    res.json({ adapters: customModels, allModels: models });
  } catch {
    res.json({ adapters: [], allModels: [], error: 'Ollama not reachable' });
  }
});

export default router;
