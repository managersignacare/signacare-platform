// apps/api/src/features/llm/adminTrainingRoutes.ts
//
// Tier 19 — admin training-platform routes.
//
// Mounted under /admin/training. Superadmin + admin only. The routes
// cover:
//
//   - PHI scrubber rules CRUD (admin-only, per-clinic + system)
//   - training_corpus_items review queue + accept/reject
//   - model_registry CRUD + red-team gate
//   - model_deployments state machine (canary → rollout → active,
//     rollback)
//   - model_surveillance_events surfacing (read-only)
//
// Red-team gate (19.5): model_deployments inserts refuse when the
// target model_registry.red_team_pass=false. No workaround path —
// the gate is enforced at the service layer, not just UI.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { ingestIntoTrainingCorpus } from './phiScrubberService';

const router = Router();
router.use(authMiddleware);
// Every endpoint here is admin-only. Superadmin bypasses via
// requireRoles in rbacMiddleware.
router.use(requireRoles(['admin', 'superadmin']));

// ── 19.1 — PHI scrubber rules ──────────────────────────────────────────────

const ScrubRuleCreateSchema = z.object({
  category: z.enum([
    'names', 'phone', 'email', 'address', 'mrn', 'date_of_birth',
    'ihi', 'medicare', 'third_party', 'case_note_id', 'custom',
  ]),
  name: z.string().min(1).max(200),
  pattern: z.string().min(1).max(2000),
  replacement: z.string().max(100).default('[REDACTED]'),
  precedence: z.number().int().min(1).max(10_000).default(100),
  isActive: z.boolean().optional(),
  // clinicId is NOT accepted — system rows are seeded-only; this
  // endpoint always creates per-tenant rules.
});

router.get('/scrub-rules',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('phi_scrubber_rules')
        .where(function () {
          this.whereNull('clinic_id').orWhere({ clinic_id: req.clinicId });
        })
        .select(
          'id', 'clinic_id as clinicId', 'category', 'name',
          'pattern', 'replacement', 'precedence',
          'is_active as isActive',
          'created_at as createdAt', 'updated_at as updatedAt',
        )
        .orderBy([{ column: 'precedence', order: 'asc' }, { column: 'name', order: 'asc' }]);
      res.json({ rules: rows });
    } catch (err) { next(err); }
  },
);

router.post('/scrub-rules',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ScrubRuleCreateSchema.parse(req.body);
      // Compile the regex server-side to catch invalid patterns
      // before they reach the scrubber runtime.
      try { new RegExp(dto.pattern, 'gi'); }
      catch (e) {
        res.status(400).json({ error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
      const [row] = await db('phi_scrubber_rules')
        .insert({
          clinic_id: req.clinicId,
          category: dto.category,
          name: dto.name,
          pattern: dto.pattern,
          replacement: dto.replacement,
          precedence: dto.precedence,
          is_active: dto.isActive ?? true,
        })
        .returning([
          'id', 'category', 'name', 'pattern',
          'precedence', 'is_active as isActive',
        ]);
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

const ScrubRuleUpdateSchema = ScrubRuleCreateSchema.partial();

router.patch('/scrub-rules/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ScrubRuleUpdateSchema.parse(req.body);
      if (dto.pattern !== undefined) {
        try { new RegExp(dto.pattern, 'gi'); }
        catch (e) {
          res.status(400).json({ error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
      }
      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (dto.category !== undefined) patch.category = dto.category;
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.pattern !== undefined) patch.pattern = dto.pattern;
      if (dto.replacement !== undefined) patch.replacement = dto.replacement;
      if (dto.precedence !== undefined) patch.precedence = dto.precedence;
      if (dto.isActive !== undefined) patch.is_active = dto.isActive;

      const [row] = await db('phi_scrubber_rules')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update(patch)
        .returning([
          'id', 'category', 'name', 'pattern',
          'precedence', 'is_active as isActive',
        ]);
      if (!row) { res.status(404).json({ error: 'Not found or system rule (cannot edit)' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── 19.2 — Training corpus review queue ────────────────────────────────────

const IngestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  transcript: z.string().min(1).max(200_000),
});

router.post('/corpus/ingest',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Opt-in guard: only clinics with training_opt_in=true can
      // contribute to the central corpus. Refuse otherwise with a
      // clear error so the admin knows to flip the setting.
      const settings = await db('clinic_settings')
        .where({ clinic_id: req.clinicId })
        .select('training_opt_in')
        .first();
      if (!settings?.training_opt_in) {
        res.status(409).json({
          error: 'Clinic has not opted in to training corpus contribution',
          code: 'TRAINING_OPT_OUT',
        });
        return;
      }
      const dto = IngestSchema.parse(req.body);
      const result = await ingestIntoTrainingCorpus({
        clinicId: req.clinicId!,
        sessionId: dto.sessionId,
        transcript: dto.transcript,
      });
      res.status(201).json(result);
    } catch (err) { next(err); }
  },
);

router.get('/corpus',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      let q = db('training_corpus_items')
        .select(
          'id', 'source_clinic_id as sourceClinicId',
          'source_session_id as sourceSessionId',
          'scrubber_version as scrubberVersion',
          'redaction_summary as redactionSummary',
          'status',
          'reviewed_by as reviewedBy', 'reviewed_at as reviewedAt',
          'created_at as createdAt',
        )
        .orderBy('created_at', 'desc')
        .limit(200);
      if (status) q = q.where({ status });
      // Superadmins see every tenant; admins see only their own.
      if (req.user!.role !== 'superadmin') q = q.where({ source_clinic_id: req.clinicId });
      const rows = await q;
      res.json({ items: rows });
    } catch (err) { next(err); }
  },
);

const CorpusReviewSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  rejectionReason: z.string().max(2000).optional(),
});

router.patch('/corpus/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CorpusReviewSchema.parse(req.body);
      const patch: Record<string, unknown> = {
        status: dto.status,
        reviewed_by: req.user!.id,
        reviewed_at: new Date(),
      };
      if (dto.status === 'rejected') {
        if (!dto.rejectionReason) {
          res.status(400).json({ error: 'rejectionReason required when status=rejected' });
          return;
        }
        patch.rejection_reason = dto.rejectionReason;
      }
      const q = db('training_corpus_items').where({ id: req.params.id });
      if (req.user!.role !== 'superadmin') {
        q.andWhere({ source_clinic_id: req.clinicId });
      }
      const [row] = await q.update(patch).returning(['id', 'status', 'reviewed_by', 'reviewed_at']);
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── 19.3 — Model registry ─────────────────────────────────────────────────

const ModelRegisterSchema = z.object({
  modelKind: z.enum(['scribe_llm', 'whisper_stt', 'embedding', 'classifier', 'translation', 'redactor']),
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(100),
  provider: z.enum(['ollama', 'openai', 'anthropic', 'local_hf', 'other']),
  digestSha256: z.string().length(64).optional(),
  evalScores: z.record(z.string(), z.number()).optional(),
});

// Superadmin-only: registering a model is a vendor-level action.
router.post('/models',
  requireRoles(['superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ModelRegisterSchema.parse(req.body);
      const [row] = await db('model_registry')
        .insert({
          model_kind: dto.modelKind,
          name: dto.name,
          version: dto.version,
          provider: dto.provider,
          digest_sha256: dto.digestSha256 ?? null,
          eval_scores: dto.evalScores ? JSON.stringify(dto.evalScores) : null,
          red_team_pass: false,
          registered_by: req.user!.id,
        })
        .returning([
          'id', 'model_kind as modelKind', 'name', 'version',
          'provider', 'red_team_pass as redTeamPass',
          'registered_at as registeredAt',
        ]);
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

router.get('/models',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
      const activeOnly = req.query.active !== 'false';
      let q = db('model_registry')
        .select(
          'id', 'model_kind as modelKind', 'name', 'version',
          'provider', 'digest_sha256 as digestSha256',
          'eval_scores as evalScores',
          'red_team_pass as redTeamPass',
          'red_team_report_ref as redTeamReportRef',
          'registered_by as registeredBy',
          'registered_at as registeredAt',
          'is_active as isActive',
        )
        .orderBy([{ column: 'model_kind', order: 'asc' }, { column: 'registered_at', order: 'desc' }]);
      if (kind) q = q.where({ model_kind: kind });
      if (activeOnly) q = q.where({ is_active: true });
      const rows = await q;
      res.json({ models: rows });
    } catch (err) { next(err); }
  },
);

const RedTeamSchema = z.object({
  pass: z.boolean(),
  reportRef: z.string().max(500).optional(),
});

// 19.5 — red-team gate. Only superadmin can flip red_team_pass.
router.post('/models/:id/red-team',
  requireRoles(['superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = RedTeamSchema.parse(req.body);
      const [row] = await db('model_registry')
        .where({ id: req.params.id })
        .update({
          red_team_pass: dto.pass,
          red_team_report_ref: dto.reportRef ?? null,
        })
        .returning([
          'id', 'red_team_pass as redTeamPass',
          'red_team_report_ref as redTeamReportRef',
        ]);
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── 19.4 — Model deployments (per-clinic) ──────────────────────────────────

const DeploymentCreateSchema = z.object({
  modelId: z.string().uuid(),
});

router.post('/deployments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = DeploymentCreateSchema.parse(req.body);

      // 19.5 — red-team gate enforced at the service layer. No deploy
      // for any model where red_team_pass=false. No admin override —
      // this is the invariant.
      const model = await db('model_registry').where({ id: dto.modelId }).first();
      if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
      if (!model.red_team_pass) {
        res.status(409).json({
          error: 'Model has not passed red-team evaluation. Cannot deploy.',
          code: 'RED_TEAM_GATE',
        });
        return;
      }

      const [row] = await db('model_deployments')
        .insert({
          clinic_id: req.clinicId,
          model_id: dto.modelId,
          status: 'canary',
          traffic_percentage: 0,
          deployed_by: req.user!.id,
        })
        .returning([
          'id', 'model_id as modelId', 'status',
          'traffic_percentage as trafficPercentage',
          'deployed_at as deployedAt',
        ]);
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

const DeploymentPatchSchema = z.object({
  action: z.enum(['canary_bump', 'promote', 'rollback']),
  trafficPercentage: z.number().int().min(0).max(100).optional(),
  rollbackReason: z.string().max(1000).optional(),
});

router.patch('/deployments/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = DeploymentPatchSchema.parse(req.body);
      const existing = await db('model_deployments')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      if (existing.status === 'rolled_back' || existing.status === 'superseded') {
        res.status(409).json({ error: `Deployment is ${existing.status} — no further actions` });
        return;
      }

      const patch: Record<string, unknown> = { updated_at: new Date() };
      if (dto.action === 'canary_bump') {
        if (dto.trafficPercentage === undefined) {
          res.status(400).json({ error: 'trafficPercentage required for canary_bump' });
          return;
        }
        patch.status = 'rollout';
        patch.traffic_percentage = dto.trafficPercentage;
      } else if (dto.action === 'promote') {
        patch.status = 'active';
        patch.traffic_percentage = 100;
        patch.promoted_at = new Date();
      } else {
        // rollback
        if (!dto.rollbackReason) {
          res.status(400).json({ error: 'rollbackReason required for rollback' });
          return;
        }
        patch.status = 'rolled_back';
        patch.traffic_percentage = 0;
        patch.rolled_back_at = new Date();
        patch.rollback_reason = dto.rollbackReason;
      }

      const [row] = await db('model_deployments')
        .where({ id: existing.id, clinic_id: req.clinicId })
        .update(patch)
        .returning([
          'id', 'model_id as modelId', 'status',
          'traffic_percentage as trafficPercentage',
          'promoted_at as promotedAt', 'rolled_back_at as rolledBackAt',
          'rollback_reason as rollbackReason',
        ]);
      res.json(row);
    } catch (err) { next(err); }
  },
);

router.get('/deployments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('model_deployments')
        .where({ clinic_id: req.clinicId })
        .select(
          'id', 'model_id as modelId', 'status',
          'traffic_percentage as trafficPercentage',
          'deployed_by as deployedBy', 'deployed_at as deployedAt',
          'promoted_at as promotedAt', 'rolled_back_at as rolledBackAt',
          'rollback_reason as rollbackReason',
        )
        .orderBy('deployed_at', 'desc')
        .limit(100);
      res.json({ deployments: rows });
    } catch (err) { next(err); }
  },
);

// ── 19.6 — Surveillance events (read-only) ────────────────────────────────

router.get('/surveillance',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
      let q = db('model_surveillance_events')
        .select(
          'id', 'source_clinic_id as sourceClinicId',
          'deployment_id as deploymentId', 'model_id as modelId',
          'event_type as eventType', 'severity', 'payload',
          'created_at as createdAt',
        )
        .orderBy('created_at', 'desc')
        .limit(200);
      if (severity) q = q.where({ severity });
      if (req.user!.role !== 'superadmin') q = q.where({ source_clinic_id: req.clinicId });
      const rows = await q;
      res.json({ events: rows });
    } catch (err) { next(err); }
  },
);

// ── 19.7 — Training opt-in toggle ─────────────────────────────────────────

const OptInSchema = z.object({ optIn: z.boolean() });

router.post('/opt-in',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { optIn } = OptInSchema.parse(req.body);
      const [row] = await db('clinic_settings')
        .where({ clinic_id: req.clinicId })
        .update({
          training_opt_in: optIn,
          training_opt_in_changed_by: req.user!.id,
          training_opt_in_changed_at: new Date(),
        })
        .returning([
          'clinic_id as clinicId',
          'training_opt_in as trainingOptIn',
          'training_opt_in_changed_at as changedAt',
        ]);
      if (!row) { res.status(404).json({ error: 'Clinic settings not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

export default router;
