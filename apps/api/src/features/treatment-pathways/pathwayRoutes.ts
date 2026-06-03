/**
 * Treatment Pathway Routes
 * CBT, DBT, ACT, EMDR, Schema Therapy tracking
 *
 * BUG-402 — PATCH and POST /:id/session use the repository's opt-locked
 * update path. Race-condition class (silent overwrite of milestones
 * JSONB by concurrent +1 session calls) is closed.
 *
 * R-FIX-BUG-402-ROUTE-PATCH-OPTLOCK
 * R-FIX-BUG-402-ROUTE-SESSION-OPTLOCK
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireClinicModuleEnabled } from '../../middleware/clinicModuleMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead, requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError } from '../../shared/errors';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import {
  AssignPathwayInterventionSchema,
  CreateStepCareRuleSchema,
  CreateWearableDeviceSourceSchema,
  CreatePathwaySleepHygieneCheckInSchema,
  CreatePathwayThoughtDiaryEntrySchema,
  CreateTreatmentPathwaySchema,
  DigitalPhenotypeRowsResponseSchema,
  PathwayDigitalInterventionBundleSchema,
  PathwayResearchLaneSummarySchema,
  RequestWearableSourceSyncSchema,
  StepCareRuleListResponseSchema,
  StepCareRuleSchema,
  UpdateTreatmentPathwaySchema,
  UpdateWearableDeviceSourceSchema,
  WearableDeviceSourceSchema,
  UpdateStepCareRuleSchema,
  WearableDeviceSourceCreateResponseSchema,
  WearableDeviceSourceListResponseSchema,
  WearableSurveillanceSnapshotSchema,
  WearableProviderCatalogResponseSchema,
  WearableSourceSyncOutcomeSchema,
  UpdatePathwayInterventionItemSchema,
  RecordSessionSchema,
  type TreatmentPathwayResponse,
} from '@signacare/shared';
import {
  pathwayRepository,
  type TreatmentPathwayRow,
} from './pathwayRepository';
import { pathwayService } from './pathwayService';
import { stepCareService } from './stepCareService';
import { digitalPhenotypingService } from './digitalPhenotypingService';
import behavioralPathwayRoutes from './behavioralPathwayRoutes';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.use(requireClinicModuleEnabled(MODULE_KEYS.PATHWAYS));
router.use(requireModuleRead(MODULE_KEYS.PATHWAYS));
router.use(behavioralPathwayRoutes);
const ROLES = ['clinician', 'case_manager', 'manager', 'admin', 'superadmin'];

const PATHWAY_TEMPLATES: Record<string, { name: string; sessions: number; milestones: string[] }> = {
  cbt: { name: 'Cognitive Behavioural Therapy', sessions: 12, milestones: ['Assessment & Psychoeducation', 'Cognitive Restructuring', 'Behavioural Activation', 'Relapse Prevention'] },
  dbt: { name: 'Dialectical Behaviour Therapy', sessions: 24, milestones: ['Mindfulness Skills', 'Distress Tolerance', 'Emotion Regulation', 'Interpersonal Effectiveness'] },
  act: { name: 'Acceptance & Commitment Therapy', sessions: 10, milestones: ['Values Clarification', 'Cognitive Defusion', 'Acceptance', 'Committed Action'] },
  emdr: { name: 'Eye Movement Desensitization & Reprocessing', sessions: 12, milestones: ['History & Preparation', 'Assessment & Desensitization', 'Installation', 'Body Scan & Closure'] },
  ipp: { name: 'Interpersonal Psychotherapy', sessions: 16, milestones: ['Initial Phase', 'Middle Phase (Focus Area)', 'Termination Phase'] },
  schema: { name: 'Schema Therapy', sessions: 20, milestones: ['Schema Identification', 'Schema Mode Work', 'Limited Reparenting', 'Behavioural Pattern Breaking'] },
  cat: { name: 'Cognitive Analytic Therapy', sessions: 16, milestones: ['Reformulation', 'Recognition', 'Revision', 'Ending'] },
};

function parseMilestones(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; }
  }
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function readCanonicalPathwayType(milestones: Record<string, unknown>, pathwayId: string): string {
  const value = milestones.pathwayType;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  throw new AppError(
    'Treatment pathway milestones missing canonical pathwayType',
    500,
    'PATHWAY_RESPONSE_SHAPE_INVALID',
    { pathwayId, missingField: 'pathwayType' },
  );
}

function readCanonicalTotalSessions(milestones: Record<string, unknown>, pathwayId: string): number {
  const value = milestones.totalSessions;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new AppError(
    'Treatment pathway milestones missing canonical totalSessions',
    500,
    'PATHWAY_RESPONSE_SHAPE_INVALID',
    { pathwayId, missingField: 'totalSessions' },
  );
}

function readCanonicalCompletedSessions(milestones: Record<string, unknown>, pathwayId: string): number {
  const value = milestones.completedSessions;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new AppError(
    'Treatment pathway milestones missing canonical completedSessions',
    500,
    'PATHWAY_RESPONSE_SHAPE_INVALID',
    { pathwayId, missingField: 'completedSessions' },
  );
}

function readCanonicalStartDate(
  milestones: Record<string, unknown>,
  createdAt: Date | string,
): string {
  const value = milestones.startDate;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (createdAt instanceof Date) return createdAt.toISOString();
  return String(createdAt);
}

function mapRowToResponse(r: TreatmentPathwayRow): TreatmentPathwayResponse {
  const m = parseMilestones(r.milestones);
  const totalSessions = readCanonicalTotalSessions(m, r.id);
  const completedSessions = readCanonicalCompletedSessions(m, r.id);
  const startDate = readCanonicalStartDate(m, r.created_at);
  return {
    id: r.id,
    patientId: r.patient_id,
    clinicId: r.clinic_id,
    pathwayType: readCanonicalPathwayType(m, r.id),
    pathwayName: r.name,
    status: r.status as TreatmentPathwayResponse['status'],
    totalSessions,
    completedSessions,
    startDate,
    endDate: typeof m.endDate === 'string' ? m.endDate : null,
    clinicianName: typeof m.clinicianName === 'string' ? m.clinicianName : null,
    notes: typeof m.notes === 'string' ? m.notes : null,
    lockVersion: r.lock_version,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

// GET templates
router.get('/templates', requireRoles(ROLES), (_req: Request, res: Response) => {
  res.json(PATHWAY_TEMPLATES);
});

// GET clinic pathways (aggregate view used by manager-facing pages).
// IMPORTANT: define this static route BEFORE `/patient/:patientId` so
// the literal "all" segment is not parsed as a patient UUID.
router.get('/patient/all', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await pathwayRepository.listForClinic(req.clinicId!);
    res.json(rows.map(mapRowToResponse));
  } catch (err) { next(err); }
});

// GET patient pathways
router.get('/patient/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await pathwayRepository.listForPatient(req.clinicId!, req.params.patientId);
    res.json(rows.map(mapRowToResponse));
  } catch (err) { next(err); }
});

// POST create — accepts both camelCase and snake_case (legacy frontend behaviour)
router.post('/', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const b = req.body as Record<string, unknown>;
    // Accept legacy/alternate key spellings at the route boundary,
    // then validate against the canonical schema.
    const parsed = CreateTreatmentPathwaySchema.parse({
      patientId: b.patientId ?? b.patient_id,
      episodeId: b.episodeId ?? b.episode_id,
      pathwayType: b.pathwayType ?? b.pathway_type,
      name: b.name ?? b.pathwayName ?? b.pathway_name,
      status: b.status,
      startDate: b.startDate ?? b.start_date,
      endDate: b.endDate ?? b.end_date,
      totalSessions: b.totalSessions ?? b.total_sessions,
      completedSessions: b.completedSessions ?? b.completed_sessions,
      milestones: b.milestones,
      notes: b.notes,
    });
    const clinicianId =
      (typeof b.clinicianId === 'string' && b.clinicianId.length > 0 ? b.clinicianId : null)
      ?? (typeof b.clinician_id === 'string' && b.clinician_id.length > 0 ? b.clinician_id : null)
      ?? req.user!.id;

    const template = PATHWAY_TEMPLATES[parsed.pathwayType];
    const milestonesData = template?.milestones?.map((m: string, i: number) => ({ id: i, name: m, completed: false })) ?? [];
    // R-FIX-BUG-568-ROUTE-CREATE-SERVICE
    const row = await pathwayService.create(auth, {
      patientId: parsed.patientId,
      pathwayType: parsed.pathwayType,
      pathwayName: parsed.name ?? template?.name ?? parsed.pathwayType,
      totalSessions: parsed.totalSessions ?? template?.sessions ?? 12,
      startDate: parsed.startDate || new Date().toISOString().split('T')[0],
      clinicianId,
      episodeId: parsed.episodeId ?? null,
      notes: parsed.notes ?? null,
      items: milestonesData,
    });
    res.status(201).json(mapRowToResponse(row));
  } catch (err) { next(err); }
});

// PATCH update — opt-locked. Required `expectedLockVersion` per BUG-402.
router.patch('/:id', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = UpdateTreatmentPathwaySchema.parse(req.body);
    // R-FIX-BUG-568-ROUTE-PATCH-SERVICE
    const updated = await pathwayService.update(auth, req.params.id, parsed);
    res.json(mapRowToResponse(updated));
  } catch (err) { next(err); }
});

// POST record session — opt-locked atomic increment of completedSessions.
router.post('/:id/session', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = RecordSessionSchema.parse(req.body);
    // R-FIX-BUG-568-ROUTE-SESSION-SERVICE
    const updated = await pathwayService.recordSession(auth, req.params.id, parsed);
    res.json(mapRowToResponse(updated));
  } catch (err) { next(err); }
});

router.get('/:id/digital-interventions', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const bundle = await pathwayService.getDigitalInterventions(auth, req.params.id);
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.post('/:id/digital-interventions/assign', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = AssignPathwayInterventionSchema.parse(req.body);
    const bundle = await pathwayService.assignInterventionPack(auth, req.params.id, parsed);
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.post('/:id/digital-interventions/:packId/items/:itemId', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = UpdatePathwayInterventionItemSchema.parse(req.body);
    const bundle = await pathwayService.setInterventionItemCompletion(
      auth,
      req.params.id,
      req.params.packId,
      req.params.itemId,
      parsed,
    );
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.post('/:id/thought-diary', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = CreatePathwayThoughtDiaryEntrySchema.parse(req.body);
    const bundle = await pathwayService.addThoughtDiaryEntry(auth, req.params.id, parsed);
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.post('/:id/sleep-hygiene/check-in', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = CreatePathwaySleepHygieneCheckInSchema.parse(req.body);
    const bundle = await pathwayService.addSleepHygieneCheckIn(auth, req.params.id, parsed);
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.get('/step-care/rules', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await stepCareService.listRules(buildAuthContext(req));
    res.json(StepCareRuleListResponseSchema.parse({ rules: rows }));
  } catch (err) { next(err); }
});

router.post('/step-care/rules', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = CreateStepCareRuleSchema.parse(req.body);
    const created = await stepCareService.createRule(auth, parsed);
    res.status(201).json(StepCareRuleSchema.parse(created));
  } catch (err) { next(err); }
});

router.patch('/step-care/rules/:ruleId', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = UpdateStepCareRuleSchema.parse(req.body);
    const updated = await stepCareService.updateRule(auth, req.params.ruleId, parsed);
    res.json(StepCareRuleSchema.parse(updated));
  } catch (err) { next(err); }
});

router.get('/research/effectiveness', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodDaysRaw = Number(req.query.periodDays ?? 180);
    const periodDays = Number.isFinite(periodDaysRaw)
      ? Math.max(30, Math.min(365 * 3, Math.trunc(periodDaysRaw)))
      : 180;
    const summary = await stepCareService.getResearchLaneSummary(buildAuthContext(req), periodDays);
    res.json(PathwayResearchLaneSummarySchema.parse(summary));
  } catch (err) { next(err); }
});

router.get('/research/phenotypes/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await digitalPhenotypingService.listRecentPhenotypes(
      buildAuthContext(req),
      req.params.patientId,
      Number(req.query.limit ?? 30),
    );
    res.json(DigitalPhenotypeRowsResponseSchema.parse({ rows }));
  } catch (err) { next(err); }
});

router.get('/research/surveillance/:patientId', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const snapshot = await digitalPhenotypingService.getWearableSurveillanceSnapshot(
      buildAuthContext(req),
      req.params.patientId,
    );
    res.json(WearableSurveillanceSnapshotSchema.parse(snapshot));
  } catch (err) { next(err); }
});

router.get('/wearables/providers/catalog', requireRoles(ROLES), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const providers = digitalPhenotypingService.listProviderCatalog();
    res.json(WearableProviderCatalogResponseSchema.parse({ providers }));
  } catch (err) { next(err); }
});

router.get('/wearables/:patientId/sources', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = String(req.query.includeInactive ?? 'false') === 'true';
    const sources = await digitalPhenotypingService.listDeviceSources(
      buildAuthContext(req),
      req.params.patientId,
      { includeInactive },
    );
    res.json(WearableDeviceSourceListResponseSchema.parse({ sources }));
  } catch (err) { next(err); }
});

router.get('/wearables/:patientId/surveillance', requireRoles(ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const snapshot = await digitalPhenotypingService.getWearableSurveillanceSnapshot(
      buildAuthContext(req),
      req.params.patientId,
    );
    res.json(WearableSurveillanceSnapshotSchema.parse(snapshot));
  } catch (err) { next(err); }
});

router.post('/wearables/:patientId/sources', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = CreateWearableDeviceSourceSchema.parse(req.body);
    const source = await digitalPhenotypingService.createDeviceSource(auth, req.params.patientId, parsed);
    res.status(201).json(WearableDeviceSourceCreateResponseSchema.parse({ source }));
  } catch (err) { next(err); }
});

router.patch('/wearables/:patientId/sources/:sourceId', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = UpdateWearableDeviceSourceSchema.parse(req.body);
    const source = await digitalPhenotypingService.updateDeviceSource(
      auth,
      req.params.patientId,
      req.params.sourceId,
      parsed,
    );
    res.json(WearableDeviceSourceSchema.parse(source));
  } catch (err) { next(err); }
});

router.post('/wearables/:patientId/sources/:sourceId/sync', requireRoles(ROLES), requireModuleWrite(MODULE_KEYS.PATHWAYS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const parsed = RequestWearableSourceSyncSchema.parse(req.body);
    const outcome = await digitalPhenotypingService.requestSourceSync(
      auth,
      req.params.patientId,
      req.params.sourceId,
      parsed,
    );
    res.status(202).json(WearableSourceSyncOutcomeSchema.parse(outcome));
  } catch (err) { next(err); }
});

export default router;
