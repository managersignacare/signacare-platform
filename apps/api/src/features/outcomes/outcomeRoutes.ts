/**
 * NOCC Outcome Measures Routes
 * HoNOS (Adult/65+/CA), K10/K10+, LSP-16
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import { createAutoContactRecord } from '../contacts/autoContactRecord';
import {
  CreateOutcomeMeasureSchema,
  getScaleBySlug,
  listOutcomeMeasures,
  resolveScaleByTemplateName,
} from '@signacare/shared';
import type { OutcomeMeasuresRow } from '../../db/types/outcome_measures';
import { AppError } from '../../shared/errors';
import { detectSuicideRiskSignal } from '../../shared/assessmentRisk';
import { createTaskInternal } from '../tasks/taskService';
import { emitClinicalSignal } from '../events/clinicalSignalEmitter';
import { logger } from '../../utils/logger';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.OUTCOMES));

const CLINICIAN_ROLES = ['clinician', 'admin', 'superadmin'];

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Soft-delete is explicit via deleted_at so duplicate / entered-in-error
// outcome measures can be retracted without hard-deleting the clinical row.
const OUTCOME_MEASURE_COLUMNS = [
  'id', 'patient_id', 'clinic_id', 'episode_id', 'staff_id',
  'measure_type', 'collection_occasion', 'total_score', 'items',
  'notes', 'status', 'assigned_for_patient', 'template_id',
  'template_name', 'assigned_by', 'completed_at',
  'created_at', 'updated_at', 'deleted_at',
] as const;

type OutcomeMeasureListResponse = {
  id: string;
  patient_id: string;
  patientId: string;
  clinic_id: string;
  clinicId: string;
  episode_id?: string | null;
  staff_id?: string | null;
  measure_type: string;
  measureType: string;
  collection_occasion?: string | null;
  collectionOccasion?: string | null;
  measure_date: string;
  measureDate: string;
  total_score: number;
  totalScore: number;
  items: unknown;
  notes?: string | null;
  is_signed: boolean;
  isSigned: boolean;
  created_at: string;
  createdAt: string;
};

const OutcomeMeasureGraphPointResponseSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  total_score: z.number(),
  collection_occasion: z.string().nullable(),
});

const OutcomeMeasureGraphResponseSchema = z.object({
  measureType: z.string(),
  dataPoints: z.array(OutcomeMeasureGraphPointResponseSchema),
});
const OutcomeMeasureDefinitionItemSchema = z.object({
  id: z.number().int().positive(),
  label: z.string(),
  subscale: z.string().optional(),
  domain: z.string().optional(),
});
const OutcomeMeasureDefinitionsResponseSchema = z.object({
  honos: z.array(OutcomeMeasureDefinitionItemSchema),
  honos65: z.array(OutcomeMeasureDefinitionItemSchema),
  honosca: z.array(OutcomeMeasureDefinitionItemSchema),
  k10: z.array(OutcomeMeasureDefinitionItemSchema),
  k10plus: z.array(OutcomeMeasureDefinitionItemSchema),
  lsp16: z.array(OutcomeMeasureDefinitionItemSchema),
});

function isSupportedOutcomeMeasureType(value: string | null | undefined): boolean {
  if (!value) return false;
  const bySlug = getScaleBySlug(value);
  if (bySlug?.family === 'outcome_measure') return true;
  return resolveScaleByTemplateName(value)?.family === 'outcome_measure';
}

function mapOutcomeMeasureRowToResponse(row: OutcomeMeasuresRow): OutcomeMeasureListResponse {
  return {
    id: row.id,
    patient_id: row.patient_id,
    patientId: row.patient_id,
    clinic_id: row.clinic_id,
    clinicId: row.clinic_id,
    episode_id: row.episode_id,
    staff_id: row.staff_id,
    measure_type: row.measure_type,
    measureType: row.measure_type,
    collection_occasion: row.collection_occasion,
    collectionOccasion: row.collection_occasion,
    measure_date: row.created_at,
    measureDate: row.created_at,
    total_score: row.total_score != null ? Number(row.total_score) : 0,
    totalScore: row.total_score != null ? Number(row.total_score) : 0,
    items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items ?? {}),
    notes: row.notes,
    is_signed: false,
    isSigned: false,
    created_at: row.created_at,
    createdAt: row.created_at,
  };
}

async function maybeEscalateOutcomeSuicideRisk(input: {
  clinicId: string;
  actorStaffId: string;
  patientId: string;
  episodeId: string | null;
  measureType: string;
  templateName?: string | null;
  responses: unknown;
  submittedTotalScore?: number | null;
}): Promise<void> {
  const signal = detectSuicideRiskSignal({
    measureType: input.measureType,
    templateName: input.templateName ?? null,
    responses: input.responses,
    submittedTotalScore: input.submittedTotalScore,
  });
  if (!signal.triggered) return;

  try {
    await createTaskInternal(input.clinicId, input.actorStaffId, {
      assignedToId: input.actorStaffId,
      patientId: input.patientId,
      episodeId: input.episodeId ?? undefined,
      priority: 'urgent',
      title: 'Immediate suicide-risk assessment review required',
      description:
        `Outcome measure trigger: ${signal.reason ?? 'PHQ-9 high-risk signal'}. ` +
        `Total score: ${signal.totalScore ?? 'n/a'}, Q9: ${signal.q9Score ?? 'n/a'}.`,
      dueDate: new Date().toISOString(),
    });

    await emitClinicalSignal({
      clinicId: input.clinicId,
      userId: input.actorStaffId,
      source: 'system',
      signalKey: 'outcome_phq9_suicide_risk',
      severity: 'critical',
      category: 'risk',
      title: 'PHQ-9 high suicide-risk trigger',
      body:
        `Review required now. ${signal.reason ?? 'PHQ-9 risk threshold met'}. ` +
        `Total ${signal.totalScore ?? 'n/a'}, Q9 ${signal.q9Score ?? 'n/a'}.`,
      actionUrl: `/patients/${input.patientId}`,
      dedupeKey: `outcome-phq9-risk:${input.patientId}:${Date.now()}`,
      payload: {
        patient_id: input.patientId,
        episode_id: input.episodeId,
        measure_type: input.measureType,
        total_score: signal.totalScore,
        q9_score: signal.q9Score,
        reason: signal.reason,
      },
    });
  } catch (err) {
    logger.warn(
      {
        err,
        clinicId: input.clinicId,
        patientId: input.patientId,
        measureType: input.measureType,
      },
      'Outcome suicide-risk escalation failed; continuing request',
    );
  }
}

// ── HoNOS Item Definitions ──
const HONOS_ITEMS = [
  { id: 1, label: 'Overactive, aggressive, disruptive or agitated behaviour', subscale: 'behaviour' },
  { id: 2, label: 'Non-accidental self-injury', subscale: 'behaviour' },
  { id: 3, label: 'Problem drinking or drug-taking', subscale: 'behaviour' },
  { id: 4, label: 'Cognitive problems', subscale: 'impairment' },
  { id: 5, label: 'Physical illness or disability problems', subscale: 'impairment' },
  { id: 6, label: 'Problems with hallucinations and delusions', subscale: 'symptoms' },
  { id: 7, label: 'Problems with depressed mood', subscale: 'symptoms' },
  { id: 8, label: 'Other mental and behavioural problems', subscale: 'symptoms' },
  { id: 9, label: 'Problems with relationships', subscale: 'social' },
  { id: 10, label: 'Problems with activities of daily living', subscale: 'social' },
  { id: 11, label: 'Problems with living conditions', subscale: 'social' },
  { id: 12, label: 'Problems with occupation and activities', subscale: 'social' },
];

const K10_ITEMS = [
  { id: 1, label: 'About how often did you feel tired out for no good reason?' },
  { id: 2, label: 'About how often did you feel nervous?' },
  { id: 3, label: 'About how often did you feel so nervous that nothing could calm you down?' },
  { id: 4, label: 'About how often did you feel hopeless?' },
  { id: 5, label: 'About how often did you feel restless or fidgety?' },
  { id: 6, label: 'About how often did you feel so restless you could not sit still?' },
  { id: 7, label: 'About how often did you feel depressed?' },
  { id: 8, label: 'About how often did you feel that everything was an effort?' },
  { id: 9, label: 'About how often did you feel so sad that nothing could cheer you up?' },
  { id: 10, label: 'About how often did you feel worthless?' },
];

const LSP16_ITEMS = [
  { id: 1, label: 'Does this person generally have difficulty with initiating and responding to conversation?', domain: 'communication' },
  { id: 2, label: 'Does this person generally withdraw from social contact?', domain: 'social_contact' },
  { id: 3, label: 'Does this person generally show warmth to others?', domain: 'social_contact' },
  { id: 4, label: 'Is this person generally well groomed?', domain: 'self_care' },
  { id: 5, label: 'Does this person wear clean clothes or ensure clothes are washed regularly?', domain: 'self_care' },
  { id: 6, label: 'Does this person generally have an adequate diet?', domain: 'self_care' },
  { id: 7, label: 'Does this person maintain their living space in a reasonable state?', domain: 'self_care' },
  { id: 8, label: 'Does this person generally look after and take their own prescribed medication?', domain: 'responsibility' },
  { id: 9, label: 'Is this person willing to take psychiatric medication when prescribed?', domain: 'responsibility' },
  { id: 10, label: 'Does this person co-operate with health services?', domain: 'responsibility' },
  { id: 11, label: 'Does this person generally have problems caused by alcohol/drug abuse?', domain: 'anti_social' },
  { id: 12, label: 'Does this person behave offensively?', domain: 'anti_social' },
  { id: 13, label: 'Does this person behave irresponsibly?', domain: 'anti_social' },
  { id: 14, label: 'Does this person damage or destroy property?', domain: 'anti_social' },
  { id: 15, label: 'Is this person violent to others?', domain: 'anti_social' },
  { id: 16, label: 'Does this person make and/or keep up friendships?', domain: 'social_contact' },
];

const OUTCOME_MEASURE_DEFINITIONS = Object.fromEntries(
  listOutcomeMeasures().map((entry) => {
    switch (entry.slug) {
      case 'honos':
        return [entry.slug, HONOS_ITEMS];
      case 'honos65':
        return [entry.slug, HONOS_ITEMS];
      case 'honosca':
        return [entry.slug, HONOS_ITEMS];
      case 'k10':
        return [entry.slug, K10_ITEMS];
      case 'k10plus':
        return [entry.slug, K10_ITEMS];
      case 'lsp16':
        return [entry.slug, LSP16_ITEMS];
      default:
        return [entry.slug, []];
    }
  }),
) as Record<string, unknown[]>;

// GET /api/v1/outcomes/definitions — get measure item definitions
router.get('/definitions', requireRoles(CLINICIAN_ROLES), (_req: Request, res: Response) => {
  res.json(OutcomeMeasureDefinitionsResponseSchema.parse(OUTCOME_MEASURE_DEFINITIONS));
});

// GET /api/v1/outcomes/patient/:patientId — list outcome measures for a patient
router.get('/patient/:patientId', requireRoles(CLINICIAN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    await requirePatientRelationship(auth, req.params.patientId);

    const q = db<OutcomeMeasuresRow>('outcome_measures')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .where((builder) => {
        builder.where({ assigned_for_patient: false }).orWhereNull('assigned_for_patient');
      })
      .whereNotNull('total_score')
      .orderBy('created_at', 'desc');
    if (req.query.episodeId) q.where({ episode_id: req.query.episodeId as string });
    const rows = (await q).filter((row) => isSupportedOutcomeMeasureType(row.measure_type));
    res.json(rows.map(mapOutcomeMeasureRowToResponse));
  } catch (err) { next(err); }
});

// GET /api/v1/outcomes/patient/:patientId/graph — get graphing data (scores over time)
router.get('/patient/:patientId/graph', requireRoles(CLINICIAN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    await requirePatientRelationship(auth, req.params.patientId);

    const measureType = req.query.type as string || 'honos';
    if (!isSupportedOutcomeMeasureType(measureType)) {
      return next(
        new AppError(
          'Unsupported outcome measure type',
          422,
          'UNSUPPORTED_OUTCOME_MEASURE',
          { measureType },
        ),
      );
    }
    const rows = await db<OutcomeMeasuresRow>('outcome_measures')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId, measure_type: measureType })
      .whereNull('deleted_at')
      .where((builder) => {
        builder.where({ assigned_for_patient: false }).orWhereNull('assigned_for_patient');
      })
      .whereNotNull('total_score')
      .orderBy('created_at', 'asc')
      .select('id', 'created_at', 'total_score', 'collection_occasion', 'measure_type');
    const dataPoints = rows
      .filter((row) => isSupportedOutcomeMeasureType(row.measure_type))
      .map((row) => ({
        id: row.id,
        created_at: String(row.created_at),
        total_score: row.total_score != null ? Number(row.total_score) : 0,
        collection_occasion: row.collection_occasion ?? null,
      }));
    res.json(OutcomeMeasureGraphResponseSchema.parse({ measureType, dataPoints }));
  } catch (err) { next(err); }
});

// POST /api/v1/outcomes — create a new outcome measure
router.post('/', requireRoles(CLINICIAN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CreateOutcomeMeasureSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(
        new AppError(
          'Validation error',
          422,
          'VALIDATION_ERROR',
          parsed.error.flatten(),
        ),
      );
    }
    const dto = parsed.data;
    const { patientId, episodeId, measureType, collectionOccasion, items, notes } = dto;
    const auth = buildAuthContext(req, patientId);
    await requirePatientRelationship(auth, patientId);

    // Auto-assign active episode if not provided
    let resolvedEpisodeId = episodeId || null;
    if (!resolvedEpisodeId) {
      const activeEp = await db('episodes').where({ patient_id: patientId, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').orderBy('created_at', 'desc').first();
      resolvedEpisodeId = activeEp?.id ?? null;
    }

    // Calculate scores server-side (authoritative; no client-trusted total).
    const { totalScore } = calculateScores(measureType, items as Record<string, number>);

    const [row] = await db('outcome_measures').insert({
      clinic_id: req.clinicId,
      patient_id: patientId,
      episode_id: resolvedEpisodeId,
      staff_id: req.user!.id,
      measure_type: measureType,
      collection_occasion: collectionOccasion || 'review',
      items: items,
      total_score: totalScore,
      notes: notes || null,
      created_at: new Date(),
    }).returning(OUTCOME_MEASURE_COLUMNS);

    // Auto-create a draft ABF contact record so this assessment appears in the
    // patient's Contacts subtab. Non-blocking — errors are logged internally.
    await createAutoContactRecord({
      clinicId: req.clinicId,
      patientId,
      episodeId: resolvedEpisodeId ?? undefined,
      staffId: req.user!.id,
      sourceType: 'clinical_note',
      sourceId: row.id,
      briefSummary: `Outcome measure — ${measureType.toUpperCase()} (total ${totalScore})`,
    });

    await maybeEscalateOutcomeSuicideRisk({
      clinicId: req.clinicId,
      actorStaffId: req.user!.id,
      patientId,
      episodeId: resolvedEpisodeId,
      measureType,
      responses: items,
      submittedTotalScore: totalScore,
    });

    // Map to frontend-expected shape
    res.status(201).json({
      ...row,
      total_score: row.total_score != null ? Number(row.total_score) : 0,
      totalScore: row.total_score != null ? Number(row.total_score) : 0,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
      measure_date: row.created_at,
      measureDate: row.created_at,
      is_signed: false,
      isSigned: false,
    });
  } catch (err) { next(err); }
});

// POST /api/v1/outcomes/:id/sign — sign an outcome measure
router.post('/:id/sign', requireRoles(CLINICIAN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [row] = await db('outcome_measures')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .update({
        status: 'signed',
        lock_version: db.raw('lock_version + 1'),
        updated_at: new Date(),
      })
      .returning(OUTCOME_MEASURE_COLUMNS);
    res.json(row);
  } catch (err) { next(err); }
});

// DELETE /api/v1/outcomes/:id — soft delete duplicate / entered-in-error
// outcome measures while preserving the audit trail.
router.delete('/:id', requireRoles(CLINICIAN_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await db<OutcomeMeasuresRow>('outcome_measures')
      .where({ id: req.params.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first();

    if (!row) {
      return next(new AppError('Outcome measure not found', 404, 'NOT_FOUND'));
    }

    const auth = buildAuthContext(req, row.patient_id);
    await requirePatientRelationship(auth, row.patient_id);

    const isPrivileged = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    const isAuthor = row.staff_id != null && row.staff_id === req.user?.id;
    if (!isPrivileged && !isAuthor) {
      return next(new AppError(
        'Only the recording clinician or an admin may retract this outcome measure',
        403,
        'FORBIDDEN',
      ));
    }

    await db('outcome_measures')
      .where({ id: row.id, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .update({
        deleted_at: new Date(),
        updated_at: new Date(),
        lock_version: db.raw('lock_version + 1'),
      });

    await writeAuditLog({
      clinicId: req.clinicId!,
      actorId: req.user!.id,
      action: 'SOFT_DELETE',
      tableName: 'outcome_measures',
      recordId: row.id,
      oldData: {
        patientId: row.patient_id,
        episodeId: row.episode_id ?? null,
        measureType: row.measure_type,
        totalScore: row.total_score != null ? Number(row.total_score) : null,
        assignedForPatient: row.assigned_for_patient ?? false,
        status: row.status ?? null,
      },
    });

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── Score Calculation ──
function calculateScores(measureType: string, items: Record<string, number>): { totalScore: number; subscaleScores: Record<string, number> } {
  const values = Object.values(items).map(Number).filter(v => !isNaN(v));
  const totalScore = values.reduce((a, b) => a + b, 0);

  const subscaleScores: Record<string, number> = {};
  if (measureType === 'honos' || measureType === 'honos65' || measureType === 'honosca') {
    const subscaleMap: Record<string, number[]> = {
      behaviour: [1, 2, 3],
      impairment: [4, 5],
      symptoms: [6, 7, 8],
      social: [9, 10, 11, 12],
    };
    for (const [scale, ids] of Object.entries(subscaleMap)) {
      subscaleScores[scale] = ids.reduce((sum, id) => sum + (items[String(id)] ?? 0), 0);
    }
  } else if (measureType === 'lsp16') {
    const domainMap: Record<string, number[]> = {
      self_care: [4, 5, 6, 7],
      social_contact: [2, 3, 16],
      communication: [1],
      responsibility: [8, 9, 10],
      anti_social: [11, 12, 13, 14, 15],
    };
    for (const [domain, ids] of Object.entries(domainMap)) {
      subscaleScores[domain] = ids.reduce((sum, id) => sum + (items[String(id)] ?? 0), 0);
    }
  } else if (measureType === 'k10' || measureType === 'k10plus') {
    // K10 interpretation: 10-19 likely well, 20-24 mild, 25-29 moderate, 30-50 severe
    subscaleScores['severity'] = totalScore <= 19 ? 0 : totalScore <= 24 ? 1 : totalScore <= 29 ? 2 : 3;
    subscaleScores['category'] = totalScore; // category name derived on frontend
  }

  return { totalScore, subscaleScores };
}

export default router;
