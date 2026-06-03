import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../../db/db';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requirePatientRelationship } from '../../shared/authGuards';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError, ErrorCode } from '../../shared/errors';
import { writeLlmAccessBypassAudit } from '../../shared/writeLlmAccessBypassAudit';
import { writeAuditLog } from '../../utils/audit';

const router = Router();

// ── Tier 12.5 — Clinic Scribe Vocabulary ───────────────────────────────────
//
// Per-clinic custom vocabulary composed into Whisper's `initial_prompt`.
// Admin manages via Power Settings CRUD. Categories enforced by a CHECK
// constraint on the DB side (drug_brand, drug_generic, allergen_common,
// protocol_name, condition, local_name).

const VocabCategoryEnum = z.enum([
  'drug_brand',
  'drug_generic',
  'allergen_common',
  'protocol_name',
  'condition',
  'local_name',
]);

const VocabCreateSchema = z.object({
  category: VocabCategoryEnum,
  term: z.string().min(1).max(200),
  pronunciationHint: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
});

const VocabUpdateSchema = VocabCreateSchema.partial();
const DateLikeResponseSchema = z.union([z.string(), z.date()]);

const VocabRowResponseSchema = z.object({
  id: z.string().uuid(),
  category: VocabCategoryEnum,
  term: z.string(),
  pronunciationHint: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: DateLikeResponseSchema,
  updatedAt: DateLikeResponseSchema,
});

const VocabListResponseSchema = z.object({
  terms: z.array(VocabRowResponseSchema),
});

const NoteTemplateVariantResponseSchema = z.enum([
  'psychiatric',
  'psychology',
  'nursing',
  'social_work',
  'gp',
  'outpatient_dictation',
  'allied_health',
]);

const ScribeNoteTemplateRowResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable(),
  variant: NoteTemplateVariantResponseSchema,
  name: z.string(),
  systemPrompt: z.string(),
  userPromptTemplate: z.string(),
  sections: z.union([z.array(z.string()), z.string(), z.null()]),
  isActive: z.boolean(),
});

const ScribeNoteTemplateDbRowSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid().nullable(),
  variant: NoteTemplateVariantResponseSchema,
  name: z.string(),
  systemPrompt: z.string(),
  userPromptTemplate: z.string(),
  sections: z.union([z.array(z.string()), z.string(), z.null()]),
  isActive: z.boolean(),
});

const ScribeNoteTemplateCreateResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  variant: NoteTemplateVariantResponseSchema,
  name: z.string(),
  isActive: z.boolean(),
});

const ScribeNoteTemplateListResponseSchema = z.object({
  templates: z.array(ScribeNoteTemplateRowResponseSchema),
});

const SemanticSearchRowResponseSchema = z.object({
  id: z.string().uuid(),
  feature: z.string(),
  patientId: z.string().uuid(),
  createdAt: DateLikeResponseSchema,
  similarity: z.coerce.number(),
});

const SemanticSearchDbRowSchema = z.object({
  id: z.string().uuid(),
  feature: z.string(),
  patientId: z.string().uuid(),
  createdAt: DateLikeResponseSchema,
  similarity: z.coerce.number(),
  pipeline: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

const SemanticSearchResponseSchema = z.object({
  results: z.array(SemanticSearchRowResponseSchema),
});

function mapVocabRowToResponse(row: unknown) {
  return VocabRowResponseSchema.parse(row);
}

function mapVocabListToResponse(rows: unknown) {
  const parsedRows = z.array(z.unknown()).parse(rows).map(mapVocabRowToResponse);
  return VocabListResponseSchema.parse({ terms: parsedRows });
}

function mapScribeNoteTemplateListToResponse(rows: unknown) {
  const parsedRows = z.array(z.unknown()).parse(rows).map(mapScribeNoteTemplateRowToResponse);
  return ScribeNoteTemplateListResponseSchema.parse({ templates: parsedRows });
}

function mapScribeNoteTemplateCreateToResponse(row: unknown) {
  return ScribeNoteTemplateCreateResponseSchema.parse(row);
}

function mapSemanticSearchToResponse(rows: unknown) {
  const parsedRows = z.array(z.unknown()).parse(rows).map(mapSemanticSearchRowToResponse);
  return SemanticSearchResponseSchema.parse({ results: parsedRows });
}

function mapScribeNoteTemplateRowToResponse(row: unknown) {
  const parsed = ScribeNoteTemplateDbRowSchema.parse(row);
  const sections = parsed.sections;
  return ScribeNoteTemplateRowResponseSchema.parse({ ...parsed, sections });
}

function mapSemanticSearchRowToResponse(row: unknown) {
  const parsed = SemanticSearchDbRowSchema.parse(row);
  const pipeline = parsed.pipeline;
  const metadata = parsed.metadata;
  void pipeline;
  void metadata;
  return SemanticSearchRowResponseSchema.parse(parsed);
}

// GET /api/v1/scribe/vocabulary — list clinic's vocabulary (optionally
// filtered by category + active state). Any authenticated scribe user
// can read so the Whisper prompt builder works at record-start.
router.get('/vocabulary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const onlyActive = req.query.active !== 'false';

    let q = db('clinic_scribe_vocabulary')
      .where({ clinic_id: req.clinicId })
      .select(
        'id',
        'category',
        'term',
        'pronunciation_hint as pronunciationHint',
        'is_active as isActive',
        'created_at as createdAt',
        'updated_at as updatedAt',
      )
      .orderBy([
        { column: 'category', order: 'asc' },
        { column: 'term', order: 'asc' },
      ]);

    if (category) q = q.andWhere({ category });
    if (onlyActive) q = q.andWhere({ is_active: true });

    const rows = await q;
    res.json(mapVocabListToResponse(rows));
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/scribe/vocabulary — admin-only create
router.post(
  '/vocabulary',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = VocabCreateSchema.parse(req.body);
      const [row] = await db('clinic_scribe_vocabulary')
        .insert({
          clinic_id: req.clinicId,
          category: dto.category,
          term: dto.term,
          pronunciation_hint: dto.pronunciationHint ?? null,
          is_active: dto.isActive ?? true,
        })
        .returning([
          'id',
          'category',
          'term',
          'pronunciation_hint as pronunciationHint',
          'is_active as isActive',
          'created_at as createdAt',
          'updated_at as updatedAt',
        ]);

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'CREATE',
        tableName: 'clinic_scribe_vocabulary',
        recordId: row.id,
        newData: { category: dto.category, term: dto.term },
      });

      res.status(201).json(mapVocabRowToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/scribe/vocabulary/:id — admin-only edit
router.patch(
  '/vocabulary/:id',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = VocabUpdateSchema.parse(req.body);
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (dto.category !== undefined) patch.category = dto.category;
      if (dto.term !== undefined) patch.term = dto.term;
      if (dto.pronunciationHint !== undefined) patch.pronunciation_hint = dto.pronunciationHint;
      if (dto.isActive !== undefined) patch.is_active = dto.isActive;

      const [row] = await db('clinic_scribe_vocabulary')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(patch)
        .returning([
          'id',
          'category',
          'term',
          'pronunciation_hint as pronunciationHint',
          'is_active as isActive',
          'created_at as createdAt',
          'updated_at as updatedAt',
        ]);

      if (!row) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'UPDATE',
        tableName: 'clinic_scribe_vocabulary',
        recordId: row.id,
        newData: dto,
      });

      res.json(mapVocabRowToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/scribe/vocabulary/:id — admin-only hard delete
// (vocabulary is metadata, not clinical content — no soft-delete column).
router.delete(
  '/vocabulary/:id',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('clinic_scribe_vocabulary')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .delete();
      if (!deleted) return next(new AppError('Not found', 404, ErrorCode.NOT_FOUND));

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'DELETE',
        tableName: 'clinic_scribe_vocabulary',
        recordId: req.params.id,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// ── Tier 13.5 — Note templates (nursing + other variants) ──────────────────
//
// GET /scribe/note-templates — list available variants. System rows
// (clinic_id IS NULL) + per-clinic overrides come back in one list;
// the variant column distinguishes them.
router.get('/note-templates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await db('scribe_note_templates')
      .where(function () {
        this.whereNull('clinic_id').orWhere({ clinic_id: req.clinicId });
      })
      .andWhere({ is_active: true })
      .select(
        'id',
        'clinic_id as clinicId',
        'variant',
        'name',
        'system_prompt as systemPrompt',
        'user_prompt_template as userPromptTemplate',
        'sections',
        'is_active as isActive',
      )
      .orderBy([
        { column: 'variant', order: 'asc' },
        { column: 'clinic_id', order: 'asc' },
      ]);
    res.json(mapScribeNoteTemplateListToResponse(rows));
  } catch (err) {
    next(err);
  }
});

const TemplateUpsertSchema = z.object({
  variant: z.enum([
    'psychiatric',
    'psychology',
    'nursing',
    'social_work',
    'gp',
    'outpatient_dictation',
    'allied_health',
  ]),
  name: z.string().min(1).max(200),
  systemPrompt: z.string().min(1),
  userPromptTemplate: z.string().min(1),
  sections: z.array(z.string()).default([]),
  isActive: z.boolean().optional(),
});

// POST /scribe/note-templates — admin-only clinic-scoped override.
// Cannot write to system rows (clinic_id IS NULL) via this endpoint —
// those are seed data only.
router.post(
  '/note-templates',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = TemplateUpsertSchema.parse(req.body);
      const [row] = await db('scribe_note_templates')
        .insert({
          clinic_id: req.clinicId,
          variant: dto.variant,
          name: dto.name,
          system_prompt: dto.systemPrompt,
          user_prompt_template: dto.userPromptTemplate,
          sections: JSON.stringify(dto.sections),
          is_active: dto.isActive ?? true,
        })
        .returning(['id', 'clinic_id as clinicId', 'variant', 'name', 'is_active as isActive']);
      res.status(201).json(mapScribeNoteTemplateCreateToResponse(row));
    } catch (err) {
      next(err);
    }
  },
);

// ── Tier 13.3 — Semantic search ────────────────────────────────────────────
//
// POST /scribe/search — kNN-nearest transcripts for a query string.
// Requires the client to pre-compute the embedding using the same
// model as the one that wrote the embeddings (contract: 1536-dim
// cosine). This endpoint does NOT call the embedding model — that
// belongs in the scribe pipeline's model-version-locked layer so the
// same vector space is used for write + read.

// BUG-036 L4 review (dim 5): patientId was optional pre-fix, which left a
// clinic-wide PHI-fishing vector — an absent patientId returned a kNN over
// ALL llm_interactions in the clinic with patient_id in the row shape, so
// a clinician with no care relationship could submit any embedding and
// enumerate patient IDs with similar interactions. Now REQUIRED. Cross-
// patient admin-scoped search (QA / training-data review) needs a separate
// endpoint with its own audit-scope permission; tracked under BUG-276.
const SemanticSearchSchema = z.object({
  embedding: z.array(z.number()).length(1536),
  topK: z.number().int().min(1).max(50).default(10),
  patientId: z.string().uuid(),
});

router.post('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { embedding, topK, patientId } = SemanticSearchSchema.parse(req.body);

    // BUG-036 — patient-relationship gate. patientId is REQUIRED per
    // SemanticSearchSchema (L4 review dim 5 — optional patientId was a
    // clinic-wide PHI-fishing vector). Vector similarity over a patient's
    // llm_interactions leaks latent PHI; the relationship check must pass
    // before the kNN runs.
    const auth = buildAuthContext(req, patientId);
    await requirePatientRelationship(auth, patientId);

    // pgvector cosine distance: `embedding <=> query` (lower = closer).
    // RLS on llm_interactions scopes by clinic_id already.
    // BUG-036: patient_id filter is now UNCONDITIONAL (schema makes
    // patientId required; relationship check above already ran).
    const rows = await db('llm_interactions')
      .whereNotNull('embedding')
      .andWhere({ clinic_id: req.clinicId, patient_id: patientId })
      .select(
        'id',
        'feature',
        'patient_id as patientId',
        'created_at as createdAt',
        db.raw('1 - (embedding <=> ?::vector) as similarity', [JSON.stringify(embedding)]),
      )
      .orderByRaw('embedding <=> ?::vector ASC', [JSON.stringify(embedding)])
      .limit(topK);
    // BUG-279 — explicit bypass-role audit for /scribe/search.
    await writeLlmAccessBypassAudit({
      req,
      patientId,
      endpoint: '/scribe/search',
      feature: 'scribe-search',
    });
    res.json(mapSemanticSearchToResponse(rows));
  } catch (err) {
    next(err);
  }
});

export default router;
