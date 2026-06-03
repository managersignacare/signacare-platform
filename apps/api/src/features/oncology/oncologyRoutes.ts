/**
 * apps/api/src/features/oncology/oncologyRoutes.ts
 *
 * Phase 8 — Oncology routes. Six entities under a single router
 * mounted at /api/v1/oncology. Every mutating endpoint is gated
 * behind the canonical MODULE_KEYS.ONCOLOGY module-access grant
 * (via requireModuleWrite, falling back to RBAC oncology role
 * permissions if no explicit grant exists — same pattern as the
 * Phase 3–7 specialties).
 *
 * Response mapping is done inline via `mapRow*` helpers so snake_case
 * DB rows never leak into the HTTP response (CLAUDE.md §5.1 + §5.2).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  ChemoCycleResponseSchema,
  CreatePrimaryCancerConditionSchema,
  CreateTnmStageGroupSchema,
  CreateEcogSchema,
  CreateTreatmentPlanSchema,
  CreateChemoCycleSchema,
  CreateTumourBoardDecisionSchema,
  EcogResponseSchema,
  PrimaryCancerConditionResponseSchema,
  TnmStageGroupResponseSchema,
  TreatmentPlanResponseSchema,
  TumourBoardDecisionResponseSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import {
  requireModuleRead,
  requireModuleWrite,
} from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { oncologyService } from './oncologyService';
import { mapChemoCycleToResponse } from './oncologyRepository';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.ONCOLOGY));

// ── Row → response mappers ───────────────────────────────────────────
//
// Phase 0.7.5 c24 D6 — mappers now take the specific typed Row from the
// repository, not an anonymous `AnyRow` index signature. The mapper
// bodies are unchanged (every field access matches the new interface's
// field names) but the type checker now catches any future rename or
// removal at compile time instead of returning `undefined` at runtime.
import type {
  PrimaryCancerConditionRow,
  TnmStageGroupRow,
  EcogPerformanceStatusRow,
  CancerTreatmentPlanRow,
  TumourBoardDecisionRow,
} from './oncologyRepository';

const ConditionsListResponseSchema = z.object({
  items: z.array(PrimaryCancerConditionResponseSchema),
});
const ConditionWriteResponseSchema = z.object({
  item: PrimaryCancerConditionResponseSchema,
});
const TnmListResponseSchema = z.object({
  items: z.array(TnmStageGroupResponseSchema),
});
const TnmWriteResponseSchema = z.object({
  item: TnmStageGroupResponseSchema,
});
const EcogListResponseSchema = z.object({
  items: z.array(EcogResponseSchema),
});
const EcogWriteResponseSchema = z.object({
  item: EcogResponseSchema,
});
const TreatmentPlansListResponseSchema = z.object({
  items: z.array(TreatmentPlanResponseSchema),
});
const TreatmentPlanWriteResponseSchema = z.object({
  item: TreatmentPlanResponseSchema,
});
const ChemoCyclesListResponseSchema = z.object({
  items: z.array(ChemoCycleResponseSchema),
});
const ChemoCycleWriteResponseSchema = z.object({
  item: ChemoCycleResponseSchema,
});
const TumourBoardListResponseSchema = z.object({
  items: z.array(TumourBoardDecisionResponseSchema),
});
const TumourBoardWriteResponseSchema = z.object({
  item: TumourBoardDecisionResponseSchema,
});

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function toIsoDateTime(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapConditionToResponse(row: PrimaryCancerConditionRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    episodeId: row.episode_id,
    icd10: row.icd10,
    snomed: row.snomed,
    histology: row.histology,
    laterality: row.laterality,
    diagnosisDate: toIsoDate(row.diagnosis_date),
    stageSystem: row.stage_system,
    notes: row.notes,
    createdByStaffId: row.created_by_staff_id,
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

function mapTnmToResponse(row: TnmStageGroupRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    conditionId: row.condition_id,
    t: row.t,
    n: row.n,
    m: row.m,
    stageGroup: row.stage_group,
    stagedAt: toIsoDate(row.staged_at),
    stagedByStaffId: row.staged_by_staff_id,
    notes: row.notes,
  };
}

function mapEcogToResponse(row: EcogPerformanceStatusRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    score: typeof row.score === 'number' ? row.score : Number(row.score),
    assessedAt: toIsoDateTime(row.assessed_at),
    assessedByStaffId: row.assessed_by_staff_id,
    notes: row.notes,
  };
}

function mapPlanToResponse(row: CancerTreatmentPlanRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    conditionId: row.condition_id,
    regimenName: row.regimen_name,
    intent: row.intent,
    protocolRef: row.protocol_ref,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    status: row.status,
    notes: row.notes,
    createdByStaffId: row.created_by_staff_id,
    createdAt: toIsoDateTime(row.created_at),
    updatedAt: toIsoDateTime(row.updated_at),
  };
}

function mapDecisionToResponse(row: TumourBoardDecisionRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    conditionId: row.condition_id,
    meetingDate: toIsoDate(row.meeting_date),
    recommendation: row.recommendation,
    rationale: row.rationale,
    attendeeStaffIds: row.attendee_staff_ids,
    chairedByStaffId: row.chaired_by_staff_id,
    createdAt: toIsoDateTime(row.created_at),
  };
}

// ── PrimaryCancerCondition ────────────────────────────────────────────

router.get(
  '/patients/:patientId/conditions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const rows = await oncologyService.listConditionsForPatient(auth, req.params.patientId);
      res.json(ConditionsListResponseSchema.parse({ items: rows.map(mapConditionToResponse) }));
    } catch (err) { next(err); }
  },
);

router.post(
  '/conditions',
  requireModuleWrite(MODULE_KEYS.ONCOLOGY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePrimaryCancerConditionSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const row = await oncologyService.createCondition(auth, dto);
      res.status(201).json(ConditionWriteResponseSchema.parse({ item: mapConditionToResponse(row) }));
    } catch (err) { next(err); }
  },
);

// ── TNMStageGroup ─────────────────────────────────────────────────────

router.get(
  '/conditions/:conditionId/stage-groups',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const rows = await oncologyService.listTnmStageGroups(auth, req.params.conditionId);
      res.json(TnmListResponseSchema.parse({ items: rows.map(mapTnmToResponse) }));
    } catch (err) { next(err); }
  },
);

router.post(
  '/stage-groups',
  requireModuleWrite(MODULE_KEYS.ONCOLOGY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateTnmStageGroupSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const row = await oncologyService.createTnmStageGroup(auth, dto);
      res.status(201).json(TnmWriteResponseSchema.parse({ item: mapTnmToResponse(row) }));
    } catch (err) { next(err); }
  },
);

// ── ECOGPerformanceStatus ─────────────────────────────────────────────

router.get(
  '/patients/:patientId/ecog',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const rows = await oncologyService.listEcog(auth, req.params.patientId);
      res.json(EcogListResponseSchema.parse({ items: rows.map(mapEcogToResponse) }));
    } catch (err) { next(err); }
  },
);

router.post(
  '/ecog',
  requireModuleWrite(MODULE_KEYS.ONCOLOGY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateEcogSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const row = await oncologyService.createEcog(auth, dto);
      res.status(201).json(EcogWriteResponseSchema.parse({ item: mapEcogToResponse(row) }));
    } catch (err) { next(err); }
  },
);

// ── CancerTreatmentPlan ───────────────────────────────────────────────

router.get(
  '/conditions/:conditionId/treatment-plans',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const rows = await oncologyService.listTreatmentPlans(auth, req.params.conditionId);
      res.json(TreatmentPlansListResponseSchema.parse({ items: rows.map(mapPlanToResponse) }));
    } catch (err) { next(err); }
  },
);

router.post(
  '/treatment-plans',
  requireModuleWrite(MODULE_KEYS.ONCOLOGY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateTreatmentPlanSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const row = await oncologyService.createTreatmentPlan(auth, dto);
      res.status(201).json(TreatmentPlanWriteResponseSchema.parse({ item: mapPlanToResponse(row) }));
    } catch (err) { next(err); }
  },
);

// ── ChemoCycle ────────────────────────────────────────────────────────

router.get(
  '/treatment-plans/:planId/cycles',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const rows = await oncologyService.listChemoCycles(auth, req.params.planId);
      res.json(ChemoCyclesListResponseSchema.parse({ items: rows.map(mapChemoCycleToResponse) }));
    } catch (err) { next(err); }
  },
);

router.post(
  '/cycles',
  requireModuleWrite(MODULE_KEYS.ONCOLOGY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateChemoCycleSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const row = await oncologyService.createChemoCycle(auth, dto);
      res.status(201).json(ChemoCycleWriteResponseSchema.parse({ item: mapChemoCycleToResponse(row) }));
    } catch (err) { next(err); }
  },
);

// ── TumourBoardDecision ───────────────────────────────────────────────

router.get(
  '/conditions/:conditionId/tumour-board',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const rows = await oncologyService.listTumourBoardDecisions(auth, req.params.conditionId);
      res.json(TumourBoardListResponseSchema.parse({ items: rows.map(mapDecisionToResponse) }));
    } catch (err) { next(err); }
  },
);

router.post(
  '/tumour-board',
  requireModuleWrite(MODULE_KEYS.ONCOLOGY),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateTumourBoardDecisionSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const row = await oncologyService.createTumourBoardDecision(auth, dto);
      res.status(201).json(TumourBoardWriteResponseSchema.parse({ item: mapDecisionToResponse(row) }));
    } catch (err) { next(err); }
  },
);

export default router;
