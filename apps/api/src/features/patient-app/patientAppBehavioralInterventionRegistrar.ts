import type { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import {
  MicroLearningAssignmentListResponseSchema,
  MicroLearningCardSchema,
  RecordRoutineEventSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requirePatientOwnership } from '../../shared/authGuards';
import { behavioralEngagementService } from '../treatment-pathways/behavioralEngagementService';

type PathwayAuthContext = {
  clinicId: string;
  staffId: string;
  role: string;
  permissions: string[];
};

type RegistrarDeps = {
  assertPathwaysModuleEnabled: (clinicId: string) => Promise<void>;
  toPathwayAuthContext: (req: Request) => PathwayAuthContext;
};

const PatientMicroLearningResponseSchema = z.object({
  assignments: MicroLearningAssignmentListResponseSchema.shape.assignments,
  cards: z.array(MicroLearningCardSchema),
});

const PatientMicroLearningStatusSchema = z.object({
  status: z.enum(['opened', 'completed']),
});

export function registerPatientAppBehavioralInterventionRoutes(
  router: Router,
  {
  assertPathwaysModuleEnabled,
  toPathwayAuthContext,
}: RegistrarDeps,
): void {
  router.get('/interventions/:patientId/micro-learning', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requirePatientOwnership(req, req.params.patientId);
      await assertPathwaysModuleEnabled(req.clinicId!);
      const auth = toPathwayAuthContext(req);
      const [assignments, cards] = await Promise.all([
        behavioralEngagementService.listPatientMicroLearningAssignments(auth, req.params.patientId),
        behavioralEngagementService.listMicroLearningCards(auth),
      ]);
      res.json(PatientMicroLearningResponseSchema.parse({
        assignments,
        cards,
      }));
    } catch (err) { next(err); }
  });

  router.post('/interventions/:patientId/micro-learning/:assignmentId/status', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requirePatientOwnership(req, req.params.patientId);
      await assertPathwaysModuleEnabled(req.clinicId!);
      const { status } = PatientMicroLearningStatusSchema.parse(req.body);
      const auth = toPathwayAuthContext(req);
      await behavioralEngagementService.setMicroLearningAssignmentStatus(auth, req.params.assignmentId, status);
      if (status === 'opened') {
        await behavioralEngagementService.recordRoutineEvent(auth, {
          patientId: req.params.patientId,
          eventType: 'module_opened',
        });
      }
      res.status(202).json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/interventions/:patientId/routine-events', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requirePatientOwnership(req, req.params.patientId);
      await assertPathwaysModuleEnabled(req.clinicId!);
      const parsed = RecordRoutineEventSchema.parse({
        ...req.body,
        patientId: req.params.patientId,
      });
      const auth = toPathwayAuthContext(req);
      await behavioralEngagementService.recordRoutineEvent(auth, parsed);
      res.status(202).json({ ok: true });
    } catch (err) { next(err); }
  });
}
