import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  BehaviorContractListResponseSchema,
  ChoiceArchitectureDefaultsSchema,
  CreateBehaviorContractSchema,
  CreateMicroLearningRuleSchema,
  CreateRoutinePlanSchema,
  EscalationSlaBoardResponseSchema,
  FrictionRadarResponseSchema,
  MicroLearningAssignmentListResponseSchema,
  RecordRoutineEventSchema,
  RecoveryStreakSummarySchema,
  RoutinePlanListResponseSchema,
  SetBehavioralSegmentOverrideSchema,
  UpdateBehaviorContractSchema,
  UpdateChoiceArchitectureDefaultsSchema,
  UpdateMicroLearningRuleSchema,
  UpdateRoutinePlanSchema,
  BehavioralSegmentSchema,
  BehaviorContractSchema,
  MicroLearningCardSchema,
  MicroLearningRuleSchema,
  RoutinePlanSchema,
} from '@signacare/shared';
import { requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { behavioralEngagementService } from './behavioralEngagementService';

const router = Router();

const READ_ROLES = ['clinician', 'case_manager', 'manager', 'admin', 'superadmin'];
const WRITE_ROLES = ['clinician', 'manager', 'admin', 'superadmin'];

const AssignmentStatusSchema = z.object({
  status: z.enum(['assigned', 'opened', 'completed']),
});

router.get(
  '/behavioral/contracts/:patientId',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const contracts = await behavioralEngagementService.listBehaviorContracts(auth, req.params.patientId);
      res.json(BehaviorContractListResponseSchema.parse({ contracts }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/behavioral/contracts',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateBehaviorContractSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const created = await behavioralEngagementService.createBehaviorContract(auth, dto);
      res.status(201).json(BehaviorContractSchema.parse(created));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/behavioral/contracts/:contractId',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateBehaviorContractSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const updated = await behavioralEngagementService.updateBehaviorContract(auth, req.params.contractId, dto);
      res.json(BehaviorContractSchema.parse(updated));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/routines/:patientId',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const routines = await behavioralEngagementService.listRoutinePlans(auth, req.params.patientId);
      res.json(RoutinePlanListResponseSchema.parse({ routines }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/behavioral/routines',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateRoutinePlanSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      const created = await behavioralEngagementService.createRoutinePlan(auth, dto);
      res.status(201).json(RoutinePlanSchema.parse(created));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/behavioral/routines/:routineId',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateRoutinePlanSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const updated = await behavioralEngagementService.updateRoutinePlan(auth, req.params.routineId, dto);
      res.json(RoutinePlanSchema.parse(updated));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/behavioral/routines/events',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = RecordRoutineEventSchema.parse(req.body);
      const auth = buildAuthContext(req, dto.patientId);
      await behavioralEngagementService.recordRoutineEvent(auth, dto);
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/streaks/:patientId',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const summary = await behavioralEngagementService.getRecoveryStreakSummary(auth, req.params.patientId);
      res.json(RecoveryStreakSummarySchema.parse(summary));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/friction/:patientId',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const radar = await behavioralEngagementService.getFrictionRadar(auth, req.params.patientId);
      res.json(FrictionRadarResponseSchema.parse(radar));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/sla-board',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const board = await behavioralEngagementService.getEscalationSlaBoard(auth);
      res.json(EscalationSlaBoardResponseSchema.parse(board));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/segments/:patientId',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const segment = await behavioralEngagementService.getBehavioralSegment(auth, req.params.patientId);
      res.json(BehavioralSegmentSchema.parse(segment));
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/behavioral/segments/:patientId/override',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = SetBehavioralSegmentOverrideSchema.parse(req.body);
      const auth = buildAuthContext(req, req.params.patientId);
      const segment = await behavioralEngagementService.setBehavioralSegmentOverride(auth, req.params.patientId, dto);
      res.json(BehavioralSegmentSchema.parse(segment));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/micro-learning/cards',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const cards = await behavioralEngagementService.listMicroLearningCards(auth);
      res.json({ cards: cards.map((card) => MicroLearningCardSchema.parse(card)) });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/micro-learning/rules',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const rules = await behavioralEngagementService.listMicroLearningRules(auth);
      res.json({ rules: rules.map((rule) => MicroLearningRuleSchema.parse(rule)) });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/behavioral/micro-learning/rules',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateMicroLearningRuleSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const created = await behavioralEngagementService.createMicroLearningRule(auth, dto);
      res.status(201).json(MicroLearningRuleSchema.parse(created));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/behavioral/micro-learning/rules/:ruleId',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateMicroLearningRuleSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const updated = await behavioralEngagementService.updateMicroLearningRule(auth, req.params.ruleId, dto);
      res.json(MicroLearningRuleSchema.parse(updated));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/micro-learning/assignments/:patientId',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req, req.params.patientId);
      const assignments = await behavioralEngagementService.listPatientMicroLearningAssignments(auth, req.params.patientId);
      res.json(MicroLearningAssignmentListResponseSchema.parse({ assignments }));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/behavioral/micro-learning/assignments/:assignmentId/status',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = AssignmentStatusSchema.parse(req.body);
      const auth = buildAuthContext(req);
      await behavioralEngagementService.setMicroLearningAssignmentStatus(auth, req.params.assignmentId, parsed.status);
      res.status(202).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/behavioral/choice-architecture/defaults',
  requireRoles(READ_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const settings = await behavioralEngagementService.getChoiceArchitectureDefaults(auth);
      res.json(ChoiceArchitectureDefaultsSchema.parse(settings));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  '/behavioral/choice-architecture/defaults',
  requireRoles(WRITE_ROLES),
  requireModuleWrite(MODULE_KEYS.PATHWAYS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateChoiceArchitectureDefaultsSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const updated = await behavioralEngagementService.updateChoiceArchitectureDefaults(auth, dto);
      res.json(ChoiceArchitectureDefaultsSchema.parse(updated));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
