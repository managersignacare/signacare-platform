// apps/api/src/features/tms/tmsRoutes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead, requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { tmsService } from './tmsService';

const router = Router();
router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.TMS));

const DateLikeStringSchema = z.union([z.string(), z.date()]).transform((value) => (
  value instanceof Date ? value.toISOString() : value
));
const DateOnlyLikeStringSchema = z.union([z.string(), z.date()]).transform((value) => {
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return value.length >= 10 ? value.slice(0, 10) : value;
});

const TmsCourseResponseSchema = z.object({
  id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  episode_id: z.string().uuid().nullable(),
  treating_psychiatrist_id: z.string().uuid(),
  protocol: z.string(),
  target_area: z.string().nullable(),
  total_planned_sessions: z.coerce.number().int(),
  motor_threshold_percent: z.coerce.number().int().nullable(),
  consent_obtained: z.boolean(),
  consent_date: DateLikeStringSchema,
  consent_recorded_by: z.string().uuid(),
  indication: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
  created_at: DateLikeStringSchema,
  updated_at: DateLikeStringSchema,
  deleted_at: DateLikeStringSchema.nullable(),
});

const TmsSessionResponseSchema = z.object({
  id: z.string().uuid(),
  course_id: z.string().uuid(),
  clinic_id: z.string().uuid(),
  session_number: z.coerce.number().int(),
  session_date: DateOnlyLikeStringSchema,
  pulses_delivered: z.coerce.number().int().nullable(),
  intensity_percent: z.coerce.number().int().nullable(),
  coil_position: z.string().nullable(),
  duration_minutes: z.coerce.number().int().nullable(),
  adverse_events: z.string().nullable(),
  patient_tolerance: z.string(),
  administered_by: z.string().uuid(),
  phq9_score: z.coerce.number().int().nullable(),
  clinician_notes: z.string().nullable(),
  created_at: DateLikeStringSchema,
  updated_at: DateLikeStringSchema,
});

const TmsByPatientResponseSchema = z.object({
  courses: z.array(TmsCourseResponseSchema),
  sessions: z.array(TmsSessionResponseSchema),
});
const TmsCourseSessionsResponseSchema = z.object({
  sessions: z.array(TmsSessionResponseSchema),
});

const CreateCourseSchema = z.object({
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  protocol: z.enum(['standard', 'theta_burst', 'deep_tms']).optional(),
  targetArea: z.string().max(100).optional(),
  totalPlannedSessions: z.number().int().min(1).max(60).optional(),
  motorThresholdPercent: z.number().int().min(1).max(100).optional(),
  consentObtained: z.boolean(),
  consentDate: z.string().optional(),
  indication: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
});

const RecordSessionSchema = z.object({
  sessionDate: z.string(),
  pulsesDelivered: z.number().int().positive().optional(),
  intensityPercent: z.number().int().min(1).max(100).optional(),
  coilPosition: z.string().max(100).optional(),
  durationMinutes: z.number().int().positive().optional(),
  adverseEvents: z.string().max(2000).optional(),
  patientTolerance: z.enum(['good', 'moderate', 'poor']).optional(),
  phq9Score: z.number().int().min(0).max(27).optional(),
  clinicianNotes: z.string().max(2000).optional(),
});

router.post('/courses', requireModuleWrite(MODULE_KEYS.TMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const dto = CreateCourseSchema.parse(req.body);
    const course = await tmsService.createCourse(auth, dto);
    res.status(201).json(TmsCourseResponseSchema.parse(course));
  } catch (err) { next(err); }
});

router.post('/courses/:courseId/sessions', requireModuleWrite(MODULE_KEYS.TMS), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const dto = RecordSessionSchema.parse(req.body);
    const session = await tmsService.recordSession(auth, req.params.courseId, dto);
    res.status(201).json(TmsSessionResponseSchema.parse(session));
  } catch (err) { next(err); }
});

router.get('/patients/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req, req.params.patientId);
    const data = await tmsService.listByPatient(auth, req.params.patientId);
    res.json(TmsByPatientResponseSchema.parse(data));
  } catch (err) { next(err); }
});

router.get('/courses/:courseId/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const sessions = await tmsService.listSessionsByCourse(auth, req.params.courseId);
    res.json(TmsCourseSessionsResponseSchema.parse({ sessions }));
  } catch (err) { next(err); }
});

export default router;
