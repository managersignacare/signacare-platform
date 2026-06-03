// apps/api/src/features/ect/ectService.ts
//
// ECT (Electroconvulsive Therapy) service with AuthContext from
// day one. Every method validates permissions + specialty + patient
// relationship before accessing data.

import type { AuthContext } from '@signacare/shared';
import { db } from '../../db/db';
import { ECT_COURSES_COLUMNS } from '../../db/types/ect_courses';
import { ECT_SESSIONS_COLUMNS } from '../../db/types/ect_sessions';
import { AppError } from '../../shared/errors';
import { requirePermission, requireSpecialty, requirePatientRelationship } from '../../shared/authGuards';
import { writeAuditLog } from '../../utils/audit';

const ECT_COURSE_COLUMNS = ECT_COURSES_COLUMNS;
const ECT_SESSION_COLUMNS = ECT_SESSIONS_COLUMNS;

export const ectService = {
  async createCourse(
    auth: AuthContext,
    dto: {
      patientId: string;
      episodeId?: string;
      anaesthetistId?: string;
      consentObtained: boolean;
      consentDate?: string;
      totalPlannedSessions?: number;
      indication: string;
      notes?: string;
    },
  ) {
    requirePermission(auth, 'ect:create');
    await requireSpecialty(auth, ['psychiatry', 'mental_health']);
    await requirePatientRelationship(auth, dto.patientId);

    if (!dto.consentObtained) {
      throw new AppError('ECT requires documented patient consent', 422, 'CONSENT_REQUIRED');
    }

    const [course] = await db('ect_courses')
      .insert({
        clinic_id: auth.clinicId,
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        treating_psychiatrist_id: auth.staffId,
        anaesthetist_id: dto.anaesthetistId ?? null,
        consent_obtained: dto.consentObtained,
        consent_date: dto.consentDate ? new Date(dto.consentDate) : new Date(),
        consent_recorded_by: auth.staffId,
        total_planned_sessions: dto.totalPlannedSessions ?? 12,
        indication: dto.indication,
        status: 'planned',
        notes: dto.notes ?? null,
      })
      .returning(ECT_COURSE_COLUMNS);

    // Clinical safety: every ECT course creation is a material event —
    // consent was documented, treating psychiatrist recorded, indication
    // captured. Mandatory audit for MHA compliance + clinical
    // defensibility. See Phase 0.7.5 SD-series bug log, item I4.
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'CREATE',
      tableName: 'ect_courses',
      recordId: course.id,
      newData: {
        patient_id: dto.patientId,
        episode_id: dto.episodeId ?? null,
        treating_psychiatrist_id: auth.staffId,
        consent_obtained: dto.consentObtained,
        consent_date: course.consent_date,
        indication: dto.indication,
        total_planned_sessions: dto.totalPlannedSessions ?? 12,
      },
    });

    return course;
  },

  async recordSession(
    auth: AuthContext,
    courseId: string,
    dto: {
      sessionDate: string;
      stimulusDoseMc?: number;
      seizureDurationSec?: number;
      electrodePlacement?: string;
      anaestheticAgent?: string;
      muscleRelaxant?: string;
      preTreatmentBp?: string;
      postTreatmentBp?: string;
      mmseScore?: number;
      adverseEvents?: string;
      clinicianNotes?: string;
    },
  ) {
    requirePermission(auth, 'ect:create');
    await requireSpecialty(auth, ['psychiatry', 'mental_health']);

    const course = await db('ect_courses')
      .where({ id: courseId, clinic_id: auth.clinicId })
      .whereNull('deleted_at')
      .first();
    if (!course) throw new AppError('ECT course not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, course.patient_id as string);

    // Auto-calculate session number
    const lastSession = await db('ect_sessions')
      .where({ course_id: courseId })
      .max('session_number as max')
      .first() as { max: number | string | null } | undefined;
    const prevMax = lastSession?.max;
    const sessionNumber = (typeof prevMax === 'number' ? prevMax : typeof prevMax === 'string' ? parseInt(prevMax, 10) : 0) + 1;

    // Activate course on first session
    if (course.status === 'planned') {
      await db('ect_courses')
        .where({ id: courseId, clinic_id: auth.clinicId })
        .update({ status: 'active', updated_at: new Date() });
    }

    const [session] = await db('ect_sessions')
      .insert({
        course_id: courseId,
        clinic_id: auth.clinicId,
        session_number: sessionNumber,
        session_date: dto.sessionDate,
        stimulus_dose_mc: dto.stimulusDoseMc ?? null,
        seizure_duration_sec: dto.seizureDurationSec ?? null,
        electrode_placement: dto.electrodePlacement ?? 'bilateral',
        anaesthetic_agent: dto.anaestheticAgent ?? null,
        muscle_relaxant: dto.muscleRelaxant ?? null,
        pre_treatment_bp: dto.preTreatmentBp ?? null,
        post_treatment_bp: dto.postTreatmentBp ?? null,
        mmse_score: dto.mmseScore ?? null,
        adverse_events: dto.adverseEvents ?? null,
        clinician_notes: dto.clinicianNotes ?? null,
        administered_by: auth.staffId,
      })
      .returning(ECT_SESSION_COLUMNS);

    // Clinical safety: every ECT session administered is a material
    // treatment event. Audit captures who administered, when, dose,
    // seizure duration, and any adverse events. Mandatory for MHA/TGA
    // compliance and clinical defensibility.
    await writeAuditLog({
      clinicId: auth.clinicId,
      userId: auth.staffId,
      action: 'CREATE',
      tableName: 'ect_sessions',
      recordId: session.id,
      newData: {
        course_id: courseId,
        session_number: sessionNumber,
        session_date: dto.sessionDate,
        stimulus_dose_mc: dto.stimulusDoseMc ?? null,
        seizure_duration_sec: dto.seizureDurationSec ?? null,
        electrode_placement: dto.electrodePlacement ?? 'bilateral',
        adverse_events: dto.adverseEvents ?? null,
        administered_by: auth.staffId,
      },
    });

    return session;
  },

  async listByPatient(auth: AuthContext, patientId: string) {
    requirePermission(auth, 'ect:read');
    await requirePatientRelationship(auth, patientId);

    const courses = await db('ect_courses')
      .where({ clinic_id: auth.clinicId, patient_id: patientId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc') as Array<{ id: string }>;

    const courseIds = courses.map((c) => c.id);
    const sessions = courseIds.length > 0
      ? await db('ect_sessions')
          .whereIn('course_id', courseIds)
          .where('clinic_id', auth.clinicId)
          .orderBy('session_number', 'asc')
      : [];

    return { courses, sessions };
  },

  async listSessionsByCourse(auth: AuthContext, courseId: string) {
    requirePermission(auth, 'ect:read');
    const course = await db('ect_courses')
      .where({ id: courseId, clinic_id: auth.clinicId })
      .whereNull('deleted_at')
      .first('patient_id');
    if (!course) throw new AppError('ECT course not found', 404, 'NOT_FOUND');
    await requirePatientRelationship(auth, course.patient_id as string);
    return db('ect_sessions')
      .where({ course_id: courseId, clinic_id: auth.clinicId })
      .orderBy('session_number', 'asc');
  },
};
