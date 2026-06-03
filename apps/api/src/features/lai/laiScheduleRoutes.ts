import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { AppError } from '../../shared/errors';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requirePatientRelationship } from '../../shared/authGuards';
import { db } from '../../db/db';
import { CreateLaiValidationSchema } from '@signacare/shared';
import {
  listActiveLaiSchedules,
  listLaiSchedules,
  getLaiSchedule,
  createLaiSchedule,
  updateLaiSchedule,
  listLaiGiven,
  recordLaiGiven,
  createAimsAssessment,
  listAimsAssessments,
} from './laiScheduleController';

// Phase 0.7.5 c24 D12 — lai_validations column list (16 cols verified).
const LAI_VALIDATION_COLUMNS = [
  'id', 'clinic_id', 'lai_schedule_id', 'patient_id',
  'validated_by_staff_id', 'validation_date', 'valid_until',
  'validation_type', 'outcome', 'clinical_rationale',
  'side_effects_reviewed', 'consent_confirmed', 'blood_tests_reviewed',
  'aims_reviewed', 'notes', 'created_at',
] as const;

const router = Router();

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.LAI));

const ROLES = ['clinician', 'admin', 'manager', 'superadmin'] as const;
const WRITE_ROLES = ['clinician', 'superadmin'] as const;

// GET /api/v1/lai — List all LAI schedules for the clinic
router.get('/', requireRoles([...ROLES]), async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const rows = await db('lai_schedules').where({ clinic_id: req.clinicId }).whereNull('deleted_at').orderBy('next_due_date', 'asc');
    res.json({ data: rows });
  } catch (err) { next(err); }
});

// GET /api/v1/lai/active — List active/current LAI schedules for the clinic
router.get('/active', requireRoles([...ROLES]), listActiveLaiSchedules);

// ── Static paths BEFORE /:id to avoid UUID parse errors ──

// POST /api/v1/lai/given — Record LAI administration
router.post('/given', requireRoles([...WRITE_ROLES]), recordLaiGiven);

// POST /api/v1/lai/aims-assessments — Create AIMS assessment
router.post('/aims-assessments', requireRoles([...WRITE_ROLES]), createAimsAssessment);

// GET /api/v1/lai/patients/:patientId/lai-schedules
router.get('/patients/:patientId/lai-schedules', requireRoles([...ROLES]), listLaiSchedules);

// GET /api/v1/lai/patients/:patientId/aims-assessments
router.get('/patients/:patientId/aims-assessments', requireRoles([...ROLES]), listAimsAssessments);

// GET /api/v1/lai/patients/:patientId/validations — all validations for a patient
router.get('/patients/:patientId/validations', requireRoles([...ROLES]), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req, req.params.patientId);
    await requirePatientRelationship(auth, req.params.patientId);
    const rows = await db('lai_validations')
      .where({ clinic_id: req.clinicId, patient_id: req.params.patientId })
      .orderBy('validation_date', 'desc');
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/v1/lai/validations — record a new revalidation
router.post('/validations', requireRoles([...WRITE_ROLES]), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateLaiValidationSchema.parse(req.body);
    const { laiScheduleId, patientId, validationDate, validationType } = dto;
    const auth = buildAuthContext(req, patientId);
    await requirePatientRelationship(auth, patientId);
    const {
      outcome, clinicalRationale, sideEffectsReviewed,
      consentConfirmed, bloodTestsReviewed, aimsReviewed, notes,
    } = req.body;

    const schedule = await db('lai_schedules')
      .where({ id: laiScheduleId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first('id', 'patient_id');
    if (!schedule) {
      throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
    }
    if (schedule.patient_id !== patientId) {
      throw new AppError(
        'Validation patient does not match the LAI schedule patient',
        409,
        'SCHEDULE_PATIENT_MISMATCH',
      );
    }

    // Valid until = validation_date + 180 days (6 months)
    const vDate = new Date(validationDate);
    vDate.setDate(vDate.getDate() + 180);
    const validUntil = vDate.toISOString().split('T')[0];

    const [row] = await db('lai_validations')
      .insert({
        id: uuidv4(),
        clinic_id: req.clinicId,
        lai_schedule_id: laiScheduleId,
        patient_id: patientId,
        validated_by_staff_id: req.user!.id,
        validation_date: validationDate,
        valid_until: validUntil,
        validation_type: validationType,
        outcome: outcome ?? 'approved',
        clinical_rationale: clinicalRationale ?? null,
        side_effects_reviewed: sideEffectsReviewed ?? null,
        consent_confirmed: consentConfirmed ?? false,
        blood_tests_reviewed: bloodTestsReviewed ?? false,
        aims_reviewed: aimsReviewed ?? false,
        notes: notes ?? null,
        created_at: new Date(),
      })
      .returning(LAI_VALIDATION_COLUMNS);

    // If outcome is 'ceased', also cease the LAI schedule
    if (outcome === 'ceased') {
      await db('lai_schedules')
        .where({ id: laiScheduleId, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .update({ status: 'ceased', end_date: validationDate, updated_at: new Date() });
    }

    res.status(201).json(row);
  } catch (err) { next(err); }
});

// ── Parameterised routes ──

// GET /api/v1/lai/:id
router.get('/:id', requireRoles([...ROLES]), getLaiSchedule);

// POST /api/v1/lai
router.post('/', requireRoles([...WRITE_ROLES]), createLaiSchedule);

// PATCH /api/v1/lai/:id
router.patch('/:id', requireRoles([...WRITE_ROLES]), updateLaiSchedule);

// GET /api/v1/lai/:scheduleId/given
router.get('/:scheduleId/given', requireRoles([...ROLES]), listLaiGiven);

// GET /api/v1/lai/:scheduleId/validations
router.get('/:scheduleId/validations', requireRoles([...ROLES]), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schedule = await db('lai_schedules')
      .where({ id: req.params.scheduleId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first('patient_id');
    if (!schedule?.patient_id) {
      throw new AppError('LAI schedule not found', 404, 'NOT_FOUND');
    }
    const auth = buildAuthContext(req, schedule.patient_id);
    await requirePatientRelationship(auth, schedule.patient_id);

    const rows = await db('lai_validations')
      .where({ clinic_id: req.clinicId, lai_schedule_id: req.params.scheduleId })
      .orderBy('validation_date', 'desc');
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
