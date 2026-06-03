// apps/api/src/features/tms/tmsService.ts
//
// TMS (Transcranial Magnetic Stimulation) service with AuthContext.

import type { AuthContext } from '@signacare/shared';
import { db } from '../../db/db';
import { TMS_COURSES_COLUMNS } from '../../db/types/tms_courses';
import { TMS_SESSIONS_COLUMNS } from '../../db/types/tms_sessions';
import { AppError } from '../../shared/errors';
import { requirePermission, requireSpecialty, requirePatientRelationship } from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';

const TMS_COURSE_COLUMNS = TMS_COURSES_COLUMNS;
const TMS_SESSION_COLUMNS = TMS_SESSIONS_COLUMNS;

export const tmsService = {
  async createCourse(
    auth: AuthContext,
    dto: {
      patientId: string;
      episodeId?: string;
      protocol?: string;
      targetArea?: string;
      totalPlannedSessions?: number;
      motorThresholdPercent?: number;
      consentObtained: boolean;
      consentDate?: string;
      indication: string;
      notes?: string;
    },
  ) {
    requirePermission(auth, 'tms:create');
    await requireSpecialty(auth, ['psychiatry', 'mental_health']);
    await requirePatientRelationship(auth, dto.patientId);

    if (!dto.consentObtained) {
      throw new AppError('TMS requires documented patient consent', 422, 'CONSENT_REQUIRED');
    }

    const [course] = await db('tms_courses')
      .insert({
        clinic_id: auth.clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        treating_psychiatrist_id: auth.staffId,
        protocol: dto.protocol ?? 'standard',
        target_area: dto.targetArea ?? 'left_dlpfc',
        total_planned_sessions: dto.totalPlannedSessions ?? 20,
        motor_threshold_percent: dto.motorThresholdPercent ?? null,
        consent_obtained: dto.consentObtained,
        consent_date: dto.consentDate ? new Date(dto.consentDate) : new Date(),
        consent_recorded_by: auth.staffId,
        indication: dto.indication,
        status: 'planned',
        notes: dto.notes ?? null,
      })
      .returning(TMS_COURSE_COLUMNS);

    // Clinical safety: TMS course creation requires documented consent,
    // treating psychiatrist, indication, and protocol. Audit captures
    // these for compliance + defensibility.
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'CREATE',
      tableName: 'tms_courses',
      recordId: course.id,
      newData: {
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        treating_psychiatrist_id: auth.staffId,
        protocol: dto.protocol ?? 'standard',
        target_area: dto.targetArea ?? 'left_dlpfc',
        motor_threshold_percent: dto.motorThresholdPercent ?? null,
        consent_obtained: dto.consentObtained,
        consent_date: course.consent_date,
        indication: dto.indication,
      },
    });

    return course;
  },

  async recordSession(
    auth: AuthContext,
    courseId: string,
    dto: {
      sessionDate: string;
      pulsesDelivered?: number;
      intensityPercent?: number;
      coilPosition?: string;
      durationMinutes?: number;
      adverseEvents?: string;
      patientTolerance?: string;
      phq9Score?: number;
      clinicianNotes?: string;
    },
  ) {
    requirePermission(auth, 'tms:create');
    await requireSpecialty(auth, ['psychiatry', 'mental_health']);

    const course = await db('tms_courses')
      .where({ id: courseId, clinic_id: auth.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!course) throw new AppError('TMS course not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, course.patient_id as string);

    const lastSession = await db('tms_sessions')
      .where({ course_id: courseId })
      .max('session_number as max')
      .first() as { max: number | string | null } | undefined;
    const prevMax = lastSession?.max;
    const sessionNumber = (typeof prevMax === 'number' ? prevMax : typeof prevMax === 'string' ? parseInt(prevMax, 10) : 0) + 1;

    if (course.status === 'planned') {
      await db('tms_courses')
        .where({ id: courseId, clinic_id: auth.clinicId })
        .update({ status: 'active', updated_at: new Date() });
    }

    const [session] = await db('tms_sessions')
      .insert({
        course_id: courseId,
        clinic_id: auth.clinicId,
        session_number: sessionNumber,
        session_date: dto.sessionDate,
        pulses_delivered: dto.pulsesDelivered ?? null,
        intensity_percent: dto.intensityPercent ?? null,
        coil_position: dto.coilPosition ?? null,
        duration_minutes: dto.durationMinutes ?? null,
        adverse_events: dto.adverseEvents ?? null,
        patient_tolerance: dto.patientTolerance ?? 'good',
        administered_by: auth.staffId,
        phq9_score: dto.phq9Score ?? null,
        clinician_notes: dto.clinicianNotes ?? null,
      })
      .returning(TMS_SESSION_COLUMNS);

    // Clinical safety: every TMS session is a material treatment event.
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'CREATE',
      tableName: 'tms_sessions',
      recordId: session.id,
      newData: {
        course_id: courseId,
        session_number: sessionNumber,
        session_date: dto.sessionDate,
        pulses_delivered: dto.pulsesDelivered ?? null,
        intensity_percent: dto.intensityPercent ?? null,
        adverse_events: dto.adverseEvents ?? null,
        patient_tolerance: dto.patientTolerance ?? 'good',
        administered_by: auth.staffId,
      },
    });

    return session;
  },

  async listByPatient(auth: AuthContext, patientId: string) {
    requirePermission(auth, 'tms:read');
    await requirePatientRelationship(auth, patientId);

    const courses = await db('tms_courses')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc') as Array<{ id: string }>;

    const courseIds = courses.map((c) => c.id);
    const sessions = courseIds.length > 0
      ? await db('tms_sessions')
          .whereIn('course_id', courseIds)
          .where('clinic_id', auth.clinicId)
          .orderBy('session_number', 'asc')
      : [];

    return { courses, sessions };
  },

  async listSessionsByCourse(auth: AuthContext, courseId: string) {
    requirePermission(auth, 'tms:read');
    const course = await db('tms_courses')
      .where({ id: courseId, clinic_id: auth.clinicId })
      .whereNull('deleted_at')
      .first('patient_id');
    if (!course) throw new AppError('TMS course not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, course.patient_id as string);
    return db('tms_sessions')
      .where({ course_id: courseId, clinic_id: auth.clinicId })
      .orderBy('session_number', 'asc');
  },
};
