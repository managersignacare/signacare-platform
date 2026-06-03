// apps/api/src/features/ect/ectRoutes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead, requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { ectService } from './ectService';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.ECT));

const DateLikeStringSchema = z.union([z.string(), z.date()]).transform((value) => (
  value instanceof Date ? value.toISOString() : value
));
const DateOnlyLikeStringSchema = z.union([z.string(), z.date()]).transform((value) => {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return value.length >= 10 ? value.slice(0, 10) : value;
});

const EctCourseResponseSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  episode_id: z.string().uuid().nullable(),
  treating_psychiatrist_id: z.string().uuid(),
  anaesthetist_id: z.string().uuid().nullable(),
  consent_obtained: z.boolean(),
  consent_date: DateLikeStringSchema,
  consent_recorded_by: z.string().uuid(),
  total_planned_sessions: z.coerce.number().int(),
  indication: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
  created_at: DateLikeStringSchema,
  updated_at: DateLikeStringSchema,
  deleted_at: DateLikeStringSchema.nullable(),
});

const EctSessionResponseSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  session_number: z.coerce.number().int(),
  session_date: DateOnlyLikeStringSchema,
  stimulus_dose_mc: z.coerce.number().nullable(),
  seizure_duration_sec: z.coerce.number().int().nullable(),
  electrode_placement: z.string(),
  anaesthetic_agent: z.string().nullable(),
  muscle_relaxant: z.string().nullable(),
  pre_treatment_bp: z.string().nullable(),
  post_treatment_bp: z.string().nullable(),
  mmse_score: z.coerce.number().int().nullable(),
  adverse_events: z.string().nullable(),
  clinician_notes: z.string().nullable(),
  administered_by: z.string().uuid(),
  created_at: DateLikeStringSchema,
  updated_at: DateLikeStringSchema,
});

const EctByPatientResponseSchema = z.object({
  courses: z.array(EctCourseResponseSchema),
  sessions: z.array(EctSessionResponseSchema),
});
const EctCourseSessionsResponseSchema = z.object({
  sessions: z.array(EctSessionResponseSchema),
});

const CreateCourseSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  anaesthetistId: z.string().uuid().optional(),
  consentObtained: z.boolean(),
  consentDate: z.string().optional(),
  totalPlannedSessions: z.number().int().min(1).max(30).optional(),
  indication: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
});

const RecordSessionSchema = z.object({
  sessionDate: z.string(),
  stimulusDoseMc: z.number().positive().optional(),
  seizureDurationSec: z.number().int().min(0).optional(),
  electrodePlacement: z.enum(['bilateral', 'right_unilateral', 'bifrontal']).optional(),
  anaestheticAgent: z.string().max(100).optional(),
  muscleRelaxant: z.string().max(100).optional(),
  preTreatmentBp: z.string().max(20).optional(),
  postTreatmentBp: z.string().max(20).optional(),
  mmseScore: z.number().int().min(0).max(30).optional(),
  adverseEvents: z.string().max(2000).optional(),
  clinicianNotes: z.string().max(2000).optional(),
});

router.post('/courses', requireModuleWrite(MODULE_KEYS.ECT), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const dto = CreateCourseSchema.parse(req.body);
    const course = await ectService.createCourse(auth, dto);
    res.status(201).json(EctCourseResponseSchema.parse(course));
  } catch (err) { next(err); }
});

router.post('/courses/:courseId/sessions', requireModuleWrite(MODULE_KEYS.ECT), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const dto = RecordSessionSchema.parse(req.body);
    const session = await ectService.recordSession(auth, req.params.courseId, dto);
    res.status(201).json(EctSessionResponseSchema.parse(session));
  } catch (err) { next(err); }
});

router.get('/patients/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req, req.params.patientId);
    const data = await ectService.listByPatient(auth, req.params.patientId);
    res.json(EctByPatientResponseSchema.parse(data));
  } catch (err) { next(err); }
});

router.get('/courses/:courseId/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const sessions = await ectService.listSessionsByCourse(auth, req.params.courseId);
    res.json(EctCourseSessionsResponseSchema.parse({ sessions }));
  } catch (err) { next(err); }
});

export default router;
