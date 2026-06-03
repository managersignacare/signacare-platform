// apps/api/src/features/llm/letterStructuredRoutes.ts
//
// Tier 17 — structured clinical artefact routes.
//
// The existing /letters routes handle free-form letter authoring.
// Tier 17 adds the structured artefacts that cannot safely be
// free-form:
//
//   - capacity_assessments (17.2) — four-test framework, decision-
//     specific, conclusion CHECK-enforced.
//   - forensic_risk_formulations (17.3) — instrument + scores +
//     overall risk.
//   - letter_citations (17.4) — every factual claim cited.
//   - state_mha_forms (17.1) — per-state MHA form definitions (read).
//   - letter_tone_presets (17.5) — tone system-prompt addenda (read).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship, requireSpecialty } from '../../shared/authGuards';

const router = Router();
router.use(authMiddleware);

// ── Tier 17.1 — State MHA forms (read-only reference data) ─────────────────

router.get('/state-mha-forms',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const stateCode = typeof req.query.state === 'string' ? req.query.state.toUpperCase() : undefined;
      let q = db('state_mha_forms')
        .where({ is_active: true })
        .select(
          'id', 'state_code as stateCode', 'form_code as formCode', 'name',
          'act_reference as actReference', 'section_reference as sectionReference',
          'field_schema as fieldSchema',
          'requires_authorised_psychiatrist as requiresAuthorisedPsychiatrist',
          'max_duration_days as maxDurationDays',
        )
        .orderBy([{ column: 'state_code', order: 'asc' }, { column: 'form_code', order: 'asc' }]);
      if (stateCode) q = q.andWhere({ state_code: stateCode });
      const rows = await q;
      res.json({ forms: rows });
    } catch (err) { next(err); }
  },
);

// ── Tier 17.2 — Capacity assessments ───────────────────────────────────────

const CapacityCreateSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  letterId: z.string().uuid().optional(),
  decisionContext: z.string().min(3).max(200),
  understandNotes: z.string().max(10_000).default(''),
  retainNotes: z.string().max(10_000).default(''),
  weighNotes: z.string().max(10_000).default(''),
  communicateNotes: z.string().max(10_000).default(''),
  conclusion: z.enum(['has_capacity', 'lacks_capacity', 'indeterminate']),
  conclusionReasoning: z.string().min(10).max(20_000),
});

router.post('/capacity-assessments',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CapacityCreateSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      // Capacity is a clinical judgement — restrict to medical +
      // psychiatric + senior nursing specialties.
      await requireSpecialty(auth, ['psychiatry', 'general_practice', 'nursing']);
      await requirePatientRelationship(auth, dto.patientId);

      const [row] = await db('capacity_assessments')
        .insert({
          clinic_id: req.clinicId,
          patient_id: dto.patientId,
          episode_id: dto.episodeId ?? null,
          letter_id: dto.letterId ?? null,
          assessor_id: req.user!.id,
          decision_context: dto.decisionContext,
          understand_notes: dto.understandNotes,
          retain_notes: dto.retainNotes,
          weigh_notes: dto.weighNotes,
          communicate_notes: dto.communicateNotes,
          conclusion: dto.conclusion,
          conclusion_reasoning: dto.conclusionReasoning,
          assessed_at: new Date(),
        })
        .returning([
          'id', 'patient_id as patientId', 'decision_context as decisionContext',
          'conclusion', 'assessed_at as assessedAt', 'created_at as createdAt',
        ]);
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

router.get('/capacity-assessments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = typeof req.query.patientId === 'string' ? req.query.patientId : undefined;
      let q = db('capacity_assessments')
        .where({ clinic_id: req.clinicId })
        .select(
          'id', 'patient_id as patientId', 'episode_id as episodeId',
          'assessor_id as assessorId', 'letter_id as letterId',
          'decision_context as decisionContext',
          'conclusion', 'assessed_at as assessedAt',
          'created_at as createdAt',
        )
        .orderBy('assessed_at', 'desc')
        .limit(200);
      if (patientId) q = q.andWhere({ patient_id: patientId });
      const rows = await q;
      res.json({ assessments: rows });
    } catch (err) { next(err); }
  },
);

router.get('/capacity-assessments/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await db('capacity_assessments')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .select(
          'id', 'patient_id as patientId', 'episode_id as episodeId',
          'assessor_id as assessorId', 'letter_id as letterId',
          'decision_context as decisionContext',
          'understand_notes as understandNotes',
          'retain_notes as retainNotes',
          'weigh_notes as weighNotes',
          'communicate_notes as communicateNotes',
          'conclusion', 'conclusion_reasoning as conclusionReasoning',
          'assessed_at as assessedAt', 'created_at as createdAt',
        )
        .first();
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── Tier 17.3 — Forensic risk formulations ─────────────────────────────────

const ForensicCreateSchema = z.object({
  patientId: z.string().uuid(),
  letterId: z.string().uuid().optional(),
  instrument: z.enum(['hcr_20', 'saprof', 'start', 'vrag', 'psychopathy_checklist', 'free_form']),
  scores: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  historicalSummary: z.string().max(20_000).default(''),
  clinicalSummary: z.string().max(20_000).default(''),
  riskManagementSummary: z.string().max(20_000).default(''),
  overallRisk: z.enum(['low', 'moderate', 'high', 'very_high', 'cannot_determine']),
  overallReasoning: z.string().min(10).max(20_000),
});

router.post('/forensic-risk',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ForensicCreateSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      // Only psychiatry-trained clinicians should complete forensic
      // risk formulations. Psychology is included because
      // forensic psychologists routinely use HCR-20/SAPROF.
      await requireSpecialty(auth, ['psychiatry', 'psychology']);
      await requirePatientRelationship(auth, dto.patientId);

      const [row] = await db('forensic_risk_formulations')
        .insert({
          clinic_id: req.clinicId,
          patient_id: dto.patientId,
          assessor_id: req.user!.id,
          letter_id: dto.letterId ?? null,
          instrument: dto.instrument,
          scores: JSON.stringify(dto.scores),
          historical_summary: dto.historicalSummary,
          clinical_summary: dto.clinicalSummary,
          risk_management_summary: dto.riskManagementSummary,
          overall_risk: dto.overallRisk,
          overall_reasoning: dto.overallReasoning,
          assessed_at: new Date(),
        })
        .returning([
          'id', 'patient_id as patientId', 'instrument',
          'overall_risk as overallRisk', 'assessed_at as assessedAt',
        ]);
      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

router.get('/forensic-risk',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = typeof req.query.patientId === 'string' ? req.query.patientId : undefined;
      let q = db('forensic_risk_formulations')
        .where({ clinic_id: req.clinicId })
        .select(
          'id', 'patient_id as patientId', 'assessor_id as assessorId',
          'letter_id as letterId', 'instrument', 'overall_risk as overallRisk',
          'assessed_at as assessedAt', 'created_at as createdAt',
        )
        .orderBy('assessed_at', 'desc')
        .limit(200);
      if (patientId) q = q.andWhere({ patient_id: patientId });
      const rows = await q;
      res.json({ formulations: rows });
    } catch (err) { next(err); }
  },
);

router.get('/forensic-risk/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await db('forensic_risk_formulations')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .select(
          'id', 'patient_id as patientId', 'assessor_id as assessorId',
          'letter_id as letterId', 'instrument', 'scores',
          'historical_summary as historicalSummary',
          'clinical_summary as clinicalSummary',
          'risk_management_summary as riskManagementSummary',
          'overall_risk as overallRisk',
          'overall_reasoning as overallReasoning',
          'assessed_at as assessedAt', 'created_at as createdAt',
        )
        .first();
      if (!row) { res.status(404).json({ error: 'Not found' }); return; }
      res.json(row);
    } catch (err) { next(err); }
  },
);

// ── Tier 17.4 — Letter citations (fact grounding) ──────────────────────────

const CitationCreateSchema = z.object({
  letterId: z.string().uuid(),
  sectionId: z.string().uuid().optional(),
  sourceKind: z.enum([
    'scribe_transcript', 'clinical_note', 'lab_result', 'imaging',
    'medication_history', 'patient_self_report', 'collateral',
    'legal_document', 'other_letter',
  ]),
  sourceRef: z.string().min(1).max(200),
  sourceOffset: z.number().int().optional(),
  snippet: z.string().max(500).optional(),
  claim: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).optional(),
});

router.post('/letter-citations',
  requireRoles(['clinician', 'admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = z.array(CitationCreateSchema).min(1).max(100).parse(req.body.citations);
      const rows = await db('letter_citations')
        .insert(items.map((c) => ({
          clinic_id: req.clinicId,
          letter_id: c.letterId,
          section_id: c.sectionId ?? null,
          source_kind: c.sourceKind,
          source_ref: c.sourceRef,
          source_offset: c.sourceOffset ?? null,
          snippet: c.snippet ?? null,
          claim: c.claim,
          confidence: c.confidence ?? null,
        })))
        .returning(['id', 'letter_id as letterId', 'source_kind as sourceKind', 'claim']);
      res.status(201).json({ citations: rows });
    } catch (err) { next(err); }
  },
);

router.get('/letter-citations',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const letterId = typeof req.query.letterId === 'string' ? req.query.letterId : undefined;
      if (!letterId) { res.status(400).json({ error: 'letterId required' }); return; }
      const rows = await db('letter_citations')
        .where({ letter_id: letterId, clinic_id: req.clinicId })
        .select(
          'id', 'letter_id as letterId', 'section_id as sectionId',
          'source_kind as sourceKind', 'source_ref as sourceRef',
          'source_offset as sourceOffset', 'snippet', 'claim',
          'confidence', 'created_at as createdAt',
        )
        .orderBy('created_at', 'asc');
      res.json({ citations: rows });
    } catch (err) { next(err); }
  },
);

// ── Tier 17.5 — Tone presets (read-only, merged) ───────────────────────────

router.get('/tone-presets',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await db('letter_tone_presets')
        .where(function () {
          this.whereNull('clinic_id').orWhere({ clinic_id: req.clinicId });
        })
        .andWhere({ is_active: true })
        .select(
          'id', 'clinic_id as clinicId', 'tone_key as toneKey',
          'name', 'description',
          'system_prompt_addendum as systemPromptAddendum',
          'is_active as isActive',
        )
        .orderBy([{ column: 'tone_key', order: 'asc' }, { column: 'clinic_id', order: 'asc' }]);
      res.json({ tonePresets: rows });
    } catch (err) { next(err); }
  },
);

export default router;
