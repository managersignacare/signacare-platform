import type { Knex } from 'knex';
import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { patientController } from './patientController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import {
  blobStorage,
  buildAttachmentStorageKey,
  resolveAttachmentDownloadUrl,
} from '../../shared/blobStorage';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import { uploadLimiter } from '../../middleware/rateLimiters';
import {
  requireClinicalAccessRole,
  requirePatientReadAccess,
  requirePatientRelationship,
  requirePermissionOrClinicalLeadershipOverride,
} from '../../shared/authGuards';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { ensureClinicalNoteConsent } from '../../shared/recordingConsent';
import { AppError } from '../../shared/errors';
import {
  enforceAiDraftSignAttestationOrRespond,
  reviewedAndAdoptedPatch,
} from './aiDraftSignAttestation';
import {
  resolveFirstVisitCreateContactMeta,
  resolveFirstVisitSignPatch,
} from './firstVisitChartReviewAttestation';
import { evaluateRecentRiskAssessmentSignGate } from '../../shared/recentRiskAssessmentGate';
import {
  CreateClinicalNoteInlineSchema, UpdateClinicalNoteInlineSchema,
  RECENT_RISK_ASSESSMENT_WINDOW_HOURS,
  PatientClinicalIntelligenceSummarySchema,
  type ClinicalIntelligenceSource,
} from '@signacare/shared';
import {
  mapClinicalNoteListRowToResponse,
  mapClinicalNoteRowToResponse,
} from './patientResponseMappers';
import {
  CLINICAL_NOTE_COLUMNS,
  PATIENT_ATTACHMENT_COLUMNS,
} from './patientRouteColumns';
import { patientTeamAssignmentRouter } from './patientTeamAssignmentRouter';
import { patientDutyRelationshipRouter } from './patientDutyRelationshipRouter';
import { createTaskInternal } from '../tasks/taskService';
import { registerPatientAncillaryRoutes } from './patientAncillaryRoutes';
import {
  recordClinicalIntelligenceSummarySignal,
  toDiagnosisProgramBucket,
  toServiceProgramBucket,
} from '../../shared/postDeployTelemetry';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.rtf',
  '.xml', '.hl7', '.json', '.zip', '.dicom', '.dcm',
]);

const PathologyUploadSchema = z.object({
  investigationType: z.string().min(1).max(200),
  reportDate: z.string().optional(),
  notes: z.string().max(10000).optional(),
});

const RECENT_RISK_ASSESSMENT_REQUIRED_MESSAGE =
  `A risk assessment completed within the last ${RECENT_RISK_ASSESSMENT_WINDOW_HOURS} hours is required before signing this first psychiatric note for a new patient.`;

const SUMMARY_ARTIFACT_NOTE_SECTION = {
  ai_longitudinal_summary: 'longitudinal_summary',
  ai_clinical_formulation: 'clinical_formulation',
  ai_dsm_multiaxial_summary: 'diagnosis_summary',
  lifechart_schema: 'life_chart',
} as const;

const DAY_MS = 86_400_000;

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateOnly(value: Date | null): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function daysDiffFloor(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / DAY_MS);
}

type SummaryArtifactSection = (typeof SUMMARY_ARTIFACT_NOTE_SECTION)[keyof typeof SUMMARY_ARTIFACT_NOTE_SECTION];

function mapSummarySectionForNoteType(noteType: unknown): SummaryArtifactSection | null {
  if (typeof noteType !== 'string' || noteType.length === 0) return null;
  if (noteType in SUMMARY_ARTIFACT_NOTE_SECTION) {
    return SUMMARY_ARTIFACT_NOTE_SECTION[noteType as keyof typeof SUMMARY_ARTIFACT_NOTE_SECTION];
  }
  return null;
}

async function assertSummarySectionsUnlocked(args: {
  clinicId: string;
  patientId: string;
  sections: SummaryArtifactSection[];
}): Promise<void> {
  if (args.sections.length === 0) return;
  const rows = await db('patient_summary_signoffs')
    .where({ clinic_id: args.clinicId, patient_id: args.patientId })
    .whereIn('summary_section', args.sections)
    .select('summary_section');
  if (rows.length > 0) {
    throw new AppError(
      'This summary section has consultant sign-off and is locked from edits or hard reset.',
      409,
      'SUMMARY_SIGNOFF_LOCKED',
    );
  }
}

function respondRecentRiskAssessmentRequired(): void {
  throw new AppError(
    RECENT_RISK_ASSESSMENT_REQUIRED_MESSAGE,
    409,
    'RECENT_RISK_ASSESSMENT_REQUIRED',
  );
}

const ALLOWED_MIMES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv', 'text/plain', 'application/rtf', 'application/xml', 'application/json',
  'application/zip', 'application/dicom', 'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error(`File type ${ext} not allowed. Accepted: ${[...ALLOWED_EXTENSIONS].join(', ')}`));
      return;
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error(`MIME type ${file.mimetype} not allowed. Accepted: ${[...ALLOWED_MIMES].join(', ')}`));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

router.use(authMiddleware, tenantMiddleware);
router.use(requireModuleRead(MODULE_KEYS.PATIENTS));

const requireClinicalPatientAccess = (
  permission: string,
  access: 'read' | 'write' = 'write',
) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = buildAuthContext(req, req.params.id);
      requireClinicalAccessRole(auth);
      await requirePermissionOrClinicalLeadershipOverride(auth, permission);
      if (access === 'read') {
        await requirePatientReadAccess(auth, req.params.id);
      } else {
        await requirePatientRelationship(auth, req.params.id);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
};

router.get('/', patientController.list);
router.use(patientTeamAssignmentRouter);
router.use(patientDutyRelationshipRouter);

// Attachment counts for all patients in clinic (used by patient list for icon)
router.get('/attachment-counts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const rows = await db('patient_attachments')
      .join('patients', 'patients.id', 'patient_attachments.patient_id')
      .where('patients.clinic_id', clinicId)
      .where('patient_attachments.is_active', true)
      .groupBy('patient_attachments.patient_id')
      .select('patient_attachments.patient_id')
      .count('* as count');
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.patient_id as string] = Number(r.count);
    }
    res.json({ counts });
  } catch (err) { next(err); }
});

router.get('/review-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const now = new Date();

    // Get the most recent medical review note per patient (ward_round or title match)
    const medicalReviews = await db('clinical_notes')
      .where('clinical_notes.clinic_id', clinicId)
      .where(function (this: Knex.QueryBuilder) {
        this.where('note_type', 'ward_round')
          .orWhereRaw("title ILIKE '%medical review%'")
          .orWhereRaw("title ILIKE '%consultant review%'")
          .orWhereRaw("title ILIKE '%psychiatrist review%'")
          .orWhereRaw("title ILIKE '%medication review%'");
      })
      .select('patient_id')
      .max('created_at as last_review')
      .groupBy('patient_id');

    // Get the most recent clinician review (91-day review)
    const clinicianReviews = await db('clinical_notes')
      .where('clinical_notes.clinic_id', clinicId)
      .where(function (this: Knex.QueryBuilder) {
        this.where('note_type', 'review')
          .orWhere('note_category', '91-day-review')
          .orWhereRaw("title ILIKE '%91%day%review%'")
          .orWhereRaw("title ILIKE '%quarterly%review%'")
          .orWhereRaw("content::text ILIKE '%91_day_review%'");
      })
      .where('status', 'signed')
      .select('patient_id')
      .max('created_at as last_review')
      .groupBy('patient_id');

    const medMap = new Map<string, Date>();
    for (const r of medicalReviews) medMap.set(r.patient_id, new Date(r.last_review));

    const clinMap = new Map<string, Date>();
    for (const r of clinicianReviews) clinMap.set(r.patient_id, new Date(r.last_review));

    // Get active patients (cap at 5000 for performance)
    const patients = await db('patients').where({ clinic_id: clinicId, status: 'active' }).select('id').limit(5000);

    const overdue: Record<string, { medical: boolean; clinician: boolean; daysSinceMedical: number | null; daysSinceClinician: number | null }> = {};

    for (const p of patients) {
      const medDate = medMap.get(p.id);
      const clinDate = clinMap.get(p.id);
      const daysMed = medDate ? Math.floor((now.getTime() - medDate.getTime()) / 86400000) : null;
      const daysClin = clinDate ? Math.floor((now.getTime() - clinDate.getTime()) / 86400000) : null;
      const medOverdue = daysMed === null || daysMed > 90;
      const clinOverdue = daysClin === null || daysClin > 91;

      if (medOverdue || clinOverdue) {
        overdue[p.id] = { medical: medOverdue, clinician: clinOverdue, daysSinceMedical: daysMed, daysSinceClinician: daysClin };
      }
    }

    res.json({ overdue });
  } catch (err) { next(err); }
});

router.get('/:id/clinical-intelligence-summary', requireClinicalPatientAccess('patient:read', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const patientId = req.params.id;
    const now = new Date();
    const failedSources = new Set<ClinicalIntelligenceSource>();

    const readSafe = async <T>(
      source: ClinicalIntelligenceSource,
      fallback: T,
      reader: () => Promise<T>,
    ): Promise<T> => {
      try {
        return await reader();
      } catch (err) {
        failedSources.add(source);
        logger.warn(
          { err, clinicId, patientId, source, kind: 'patient_clinical_intelligence_source_failed' },
          'Patient clinical-intelligence source query failed',
        );
        return fallback;
      }
    };

    const flags = await readSafe(
      'flags',
      { activeFlags: 0, highRiskFlags: 0 },
      async () => {
        const rows = await db('patient_flags')
          .where({ clinic_id: clinicId, patient_id: patientId, status: 'active' })
          .whereNull('deleted_at')
          .select('severity');
        let activeFlags = 0;
        let highRiskFlags = 0;
        for (const row of rows) {
          activeFlags += 1;
          const severity = String(row.severity ?? '').toLowerCase();
          if (severity === 'high' || severity === 'critical') {
            highRiskFlags += 1;
          }
        }
        return { activeFlags, highRiskFlags };
      },
    );

    const tasks = await readSafe(
      'tasks',
      { openTasks: 0, overdueTasks: 0 },
      async () => {
        const rows = await db('tasks')
          .where({ clinic_id: clinicId, patient_id: patientId })
          .select('status', 'due_date');
        let openTasks = 0;
        let overdueTasks = 0;
        for (const row of rows) {
          const status = String(row.status ?? '').toLowerCase();
          const closed = status === 'completed' || status === 'cancelled' || status === 'canceled';
          if (closed) continue;
          openTasks += 1;
          const dueDate = toDate(row.due_date);
          if (dueDate && dueDate.getTime() < now.getTime()) {
            overdueTasks += 1;
          }
        }
        return { openTasks, overdueTasks };
      },
    );

    const appointments = await readSafe(
      'appointments',
      { dnaLast90Days: 0, upcomingAppointments7Days: 0 },
      async () => {
        const ninetyDaysAgo = new Date(now.getTime() - (90 * DAY_MS));
        const nextSevenDays = new Date(now.getTime() + (7 * DAY_MS));
        const rows = await db('appointments')
          .where({ clinic_id: clinicId, patient_id: patientId })
          .whereNull('deleted_at')
          .select('status', 'appointment_start', 'start_time');

        let dnaLast90Days = 0;
        let upcomingAppointments7Days = 0;
        for (const row of rows) {
          const status = String(row.status ?? '').toLowerCase();
          const start = toDate(row.appointment_start ?? row.start_time);
          if (!start) continue;
          if (status === 'no_show' && start >= ninetyDaysAgo && start <= now) {
            dnaLast90Days += 1;
          }
          if ((status === 'scheduled' || status === 'confirmed') && start >= now && start <= nextSevenDays) {
            upcomingAppointments7Days += 1;
          }
        }

        return { dnaLast90Days, upcomingAppointments7Days };
      },
    );

    const legalOrders = await readSafe(
      'legal_orders',
      { overdueMhaReviews: 0, upcomingMhaReviews30Days: 0 },
      async () => {
        const nextThirtyDays = new Date(now.getTime() + (30 * DAY_MS));
        const rows = await db('patient_legal_orders')
          .where({ clinic_id: clinicId, patient_id: patientId, status: 'active' })
          .where(function whereCurrent(this: Knex.QueryBuilder) {
            this.whereNull('end_date').orWhere('end_date', '>=', db.raw('CURRENT_DATE'));
          })
          .select('review_date');

        let overdueMhaReviews = 0;
        let upcomingMhaReviews30Days = 0;
        for (const row of rows) {
          const reviewDate = toDate(row.review_date);
          if (!reviewDate) continue;
          if (reviewDate < now) overdueMhaReviews += 1;
          if (reviewDate >= now && reviewDate <= nextThirtyDays) upcomingMhaReviews30Days += 1;
        }
        return { overdueMhaReviews, upcomingMhaReviews30Days };
      },
    );

    const laiSchedule = await readSafe(
      'lai_schedule',
      { overdueLaiAdministrations: 0, upcomingLaiAdministrations7Days: 0 },
      async () => {
        const nextSevenDays = new Date(now.getTime() + (7 * DAY_MS));
        const rows = await db('medication_administrations as ma')
          .join('patient_medications as pm', 'pm.id', 'ma.patient_medication_id')
          .where('ma.clinic_id', clinicId)
          .andWhere('ma.patient_id', patientId)
          .andWhere('pm.clinic_id', clinicId)
          .andWhere('pm.patient_id', patientId)
          .andWhere('pm.is_lai', true)
          .whereNull('pm.deleted_at')
          .whereIn('pm.status', ['active', 'current'])
          .whereNotIn('ma.status', ['completed', 'administered', 'given', 'cancelled', 'canceled', 'not_given'])
          .select('ma.scheduled_time');

        let overdueLaiAdministrations = 0;
        let upcomingLaiAdministrations7Days = 0;
        for (const row of rows) {
          const scheduled = toDate(row.scheduled_time);
          if (!scheduled) continue;
          if (scheduled < now) overdueLaiAdministrations += 1;
          if (scheduled >= now && scheduled <= nextSevenDays) upcomingLaiAdministrations7Days += 1;
        }
        return { overdueLaiAdministrations, upcomingLaiAdministrations7Days };
      },
    );

    const reviewSignals = await readSafe(
      'clinical_notes',
      { daysSinceLastClinicalNote: null as number | null, overdue91DayReview: true, next91DayReviewDueDate: null as string | null },
      async () => {
        const lastNote = await db('clinical_notes')
          .where({ clinic_id: clinicId, patient_id: patientId })
          .whereNull('deleted_at')
          .where('status', 'signed')
          .orderBy('created_at', 'desc')
          .first('created_at');
        const lastNoteDate = toDate(lastNote?.created_at);
        const daysSinceLastClinicalNote = lastNoteDate ? daysDiffFloor(now, lastNoteDate) : null;

        const last91Review = await db('clinical_notes')
          .where({ clinic_id: clinicId, patient_id: patientId })
          .whereNull('deleted_at')
          .where('status', 'signed')
          .where(function whereReview(this: Knex.QueryBuilder) {
            this.where('note_type', 'review')
              .orWhere('note_category', '91-day-review')
              .orWhereRaw("title ILIKE '%91%day%review%'")
              .orWhereRaw("content::text ILIKE '%91_day_review%'");
          })
          .orderBy('created_at', 'desc')
          .first('created_at');

        const last91Date = toDate(last91Review?.created_at);
        const next91Due = last91Date ? new Date(last91Date.getTime() + (91 * DAY_MS)) : null;
        const overdue91DayReview = !next91Due || next91Due < now;
        return {
          daysSinceLastClinicalNote,
          overdue91DayReview,
          next91DayReviewDueDate: toDateOnly(next91Due),
        };
      },
    );

    const outcomes = await readSafe(
      'outcomes',
      { lastOutcomeScore: null as number | null, previousOutcomeScore: null as number | null, outcomeDirection: 'unknown' as 'improving' | 'worsening' | 'stable' | 'unknown' },
      async () => {
        const rows = await db('outcome_measures')
          .where({ clinic_id: clinicId, patient_id: patientId })
          .whereNull('deleted_at')
          .whereNotNull('total_score')
          .orderBy('created_at', 'desc')
          .limit(2)
          .select('total_score');

        const parseScore = (value: unknown): number | null => {
          if (typeof value === 'number') return Number.isFinite(value) ? value : null;
          if (typeof value === 'string') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
          }
          return null;
        };

        const lastOutcomeScore = parseScore(rows[0]?.total_score);
        const previousOutcomeScore = parseScore(rows[1]?.total_score);
        let outcomeDirection: 'improving' | 'worsening' | 'stable' | 'unknown' = 'unknown';
        if (lastOutcomeScore != null && previousOutcomeScore != null) {
          if (lastOutcomeScore > previousOutcomeScore) outcomeDirection = 'worsening';
          else if (lastOutcomeScore < previousOutcomeScore) outcomeDirection = 'improving';
          else outcomeDirection = 'stable';
        }
        return { lastOutcomeScore, previousOutcomeScore, outcomeDirection };
      },
    );

    const patientProfile = await readSafe(
      'patient_profile',
      { nextBirthdayInDays: null as number | null },
      async () => {
        const row = await db('patients')
          .where({ clinic_id: clinicId, id: patientId })
          .whereNull('deleted_at')
          .first('date_of_birth');
        const dob = toDate(row?.date_of_birth);
        if (!dob) return { nextBirthdayInDays: null };
        const thisYearBirthday = new Date(Date.UTC(now.getUTCFullYear(), dob.getUTCMonth(), dob.getUTCDate()));
        const nextBirthday = thisYearBirthday.getTime() >= now.getTime()
          ? thisYearBirthday
          : new Date(Date.UTC(now.getUTCFullYear() + 1, dob.getUTCMonth(), dob.getUTCDate()));
        const nextBirthdayInDays = Math.max(0, daysDiffFloor(nextBirthday, now));
        return { nextBirthdayInDays };
      },
    );

    const calibrationProfile = await readSafe(
      'patient_profile',
      {
        diagnosisProgramBucket: 'unknown' as const,
        serviceProgramBucket: 'unknown' as const,
      },
      async () => {
        const episodeRow = await db('episodes')
          .where({ clinic_id: clinicId, patient_id: patientId })
          .whereNull('deleted_at')
          .orderByRaw(`CASE WHEN status = 'open' THEN 0 ELSE 1 END`)
          .orderBy('start_date', 'desc')
          .first('primary_diagnosis', 'episode_type');

        return {
          diagnosisProgramBucket: toDiagnosisProgramBucket(episodeRow?.primary_diagnosis),
          serviceProgramBucket: toServiceProgramBucket(episodeRow?.episode_type),
        };
      },
    );

    const failed = Array.from(failedSources);
    const failedCritical = failed.some((source) =>
      source === 'appointments' || source === 'tasks' || source === 'clinical_notes',
    );

    const state = failed.length === 0
      ? 'ok'
      : failedCritical
      ? 'degraded'
      : 'partial';

    const payload = {
      patientId,
      now: {
        activeFlags: flags.activeFlags,
        highRiskFlags: flags.highRiskFlags,
        openTasks: tasks.openTasks,
        overdueTasks: tasks.overdueTasks,
        dnaLast90Days: appointments.dnaLast90Days,
      },
      due: {
        upcomingAppointments7Days: appointments.upcomingAppointments7Days,
        overdueMhaReviews: legalOrders.overdueMhaReviews,
        upcomingMhaReviews30Days: legalOrders.upcomingMhaReviews30Days,
        overdueLaiAdministrations: laiSchedule.overdueLaiAdministrations,
        upcomingLaiAdministrations7Days: laiSchedule.upcomingLaiAdministrations7Days,
        overdue91DayReview: reviewSignals.overdue91DayReview,
        next91DayReviewDueDate: reviewSignals.next91DayReviewDueDate,
      },
      trends: {
        daysSinceLastClinicalNote: reviewSignals.daysSinceLastClinicalNote,
        nextBirthdayInDays: patientProfile.nextBirthdayInDays,
        lastOutcomeScore: outcomes.lastOutcomeScore,
        previousOutcomeScore: outcomes.previousOutcomeScore,
        outcomeDirection: outcomes.outcomeDirection,
      },
      meta: {
        generatedAt: new Date().toISOString(),
        failedSources: failed,
        state,
        calibrationContext: {
          diagnosisProgramBucket: calibrationProfile.diagnosisProgramBucket,
          serviceProgramBucket: calibrationProfile.serviceProgramBucket,
        },
      },
    };

    const parsed = PatientClinicalIntelligenceSummarySchema.parse(payload);
    recordClinicalIntelligenceSummarySignal({
      state: parsed.meta.state,
      failedSources: parsed.meta.failedSources,
      diagnosisProgramBucket: parsed.meta.calibrationContext?.diagnosisProgramBucket ?? 'unknown',
      serviceProgramBucket: parsed.meta.calibrationContext?.serviceProgramBucket ?? 'unknown',
    });
    res.json(PatientClinicalIntelligenceSummarySchema.parse(parsed));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/attachments', uploadLimiter, upload.array('files', 10), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.params.id;
    const clinicId = req.clinicId;
    const files = req.files as Express.Multer.File[];
    const labels = Array.isArray(req.body.labels) ? req.body.labels : req.body.labels ? [req.body.labels] : [];
    const uploadedBy = req.user?.id ?? null;

    // Resolve optional episode/specialty linkage. When the uploader
    // provides an episodeId, auto-resolve specialty_code from it so
    // the Documents tab's SpecialtyFilterChips can filter without
    // every uploader having to know their specialty. PATH1 (clinic_id)
    // is preserved on every query.
    let episodeId: string | null = typeof req.body.episodeId === 'string' && req.body.episodeId ? req.body.episodeId : null;
    let specialtyCode: string | null = typeof req.body.specialtyCode === 'string' && req.body.specialtyCode ? req.body.specialtyCode : null;
    if (!episodeId && !specialtyCode) {
      // Fallback: attach to the patient's most recent open episode so
      // existing uploaders (pathology, physical-health, alerts) that
      // don't yet pass episodeId still get a sensible specialty tag.
      const latest = await db('episodes')
        .where({ patient_id: patientId, clinic_id: clinicId, status: 'open' })
        .whereNull('deleted_at')
        .orderBy('start_date', 'desc')
        .first();
      if (latest) {
        episodeId = latest.id as string;
        specialtyCode = (latest.specialty_code as string | null) ?? null;
      }
    } else if (episodeId && !specialtyCode) {
      const ep = await db('episodes')
        .where({ id: episodeId, clinic_id: clinicId })
        .whereNull('deleted_at')
        .first();
      if (ep) specialtyCode = (ep.specialty_code as string | null) ?? null;
    }

    const inserted = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const storageKey = buildAttachmentStorageKey(f.originalname);
      const putResult = await blobStorage.put(storageKey, f.buffer, f.mimetype);
      try {
        const [row] = await db('patient_attachments').insert({
          id: db.raw('gen_random_uuid()'),
          clinic_id: clinicId,
          patient_id: patientId,
          episode_id: episodeId,
          specialty_code: specialtyCode,
          uploaded_by: uploadedBy,
          filename: f.originalname,
          label: labels[i] || null,
          mime_type: f.mimetype,
          file_size: f.size,
          // file_path is left for legacy GET fallback only — new rows
          // resolve their download URL via storage_key. We populate it
          // with the storage_key for consistency.
          file_path: putResult.key,
          storage_backend: putResult.backend,
          storage_key: putResult.key,
          storage_bucket: putResult.bucket,
          storage_etag: putResult.etag,
          is_active: true,
          created_at: new Date(),
        }).returning(PATIENT_ATTACHMENT_COLUMNS);
        inserted.push(row);
      } catch (dbErr) {
        // DB INSERT failed after blob was written — delete the orphan.
        try { await blobStorage.delete(storageKey); } catch { /* best-effort */ }
        throw dbErr;
      }
    }
    res.status(201).json({ attachments: inserted });
  } catch (err) { next(err); }
});

router.get('/:id/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // BUG-368: clinic_id is the Layer-1 tenant isolation; RLS is Layer-2 per
    // CLAUDE.md §1.3. Any RLS-disabled maintenance path (migration, ops
    // debug) would leak cross-clinic data without this predicate.
    const rows = await db('patient_attachments')
      .where({ patient_id: req.params.id, clinic_id: req.clinicId, is_active: true })
      .orderBy('created_at', 'desc');
    const attachments = await Promise.all(
      rows.map(async (r) => ({ ...r, downloadUrl: await resolveAttachmentDownloadUrl(r) })),
    );
    res.json({ attachments });
  } catch (err) { next(err); }
});

// ─── Pathology Reports (upload + auto-create review tasks) ───
router.post('/:id/pathology', uploadLimiter, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientId = req.params.id;
    const clinicId = req.clinicId;
    const uploadedBy = req.user?.id ?? null;
    const file = req.file as Express.Multer.File | undefined;
    const { investigationType, reportDate, notes } = PathologyUploadSchema.parse(req.body);

    // Store the report as a patient attachment with category.
    // S1.1: routes through BlobStorage. PATH1 (clinic_id) preserved.
    let attachmentId: string | null = null;
    if (file) {
      const storageKey = buildAttachmentStorageKey(file.originalname);
      const putResult = await blobStorage.put(storageKey, file.buffer, file.mimetype);
      try {
        const [row] = await db('patient_attachments').insert({
          id: db.raw('gen_random_uuid()'),
          clinic_id: req.clinicId,
          patient_id: patientId,
          uploaded_by: uploadedBy,
          filename: file.originalname,
          label: `Pathology: ${investigationType || 'Report'}`,
          mime_type: file.mimetype,
          file_size: file.size,
          file_path: putResult.key,
          storage_backend: putResult.backend,
          storage_key: putResult.key,
          storage_bucket: putResult.bucket,
          storage_etag: putResult.etag,
          is_active: true,
          created_at: new Date(),
        }).returning(PATIENT_ATTACHMENT_COLUMNS);
        attachmentId = row.id;
      } catch (dbErr) {
        try { await blobStorage.delete(storageKey); } catch { /* best-effort */ }
        throw dbErr;
      }
    }

    // Find the patient's active episode to get MDT
    const activeEpisode = await db('episodes')
      .where({ clinic_id: clinicId, patient_id: patientId, status: 'open' })
      .whereNull('deleted_at')
      .first();

    // Get patient name for task title
    const patient = await db('patients').where({ id: patientId }).select('given_name', 'family_name').first();
    const patientName = patient ? `${patient.given_name} ${patient.family_name}` : 'Patient';

    const tasksCreated: string[] = [];

    if (activeEpisode) {
      // Find junior medical staff and consultant psychiatrist from episode's team
      const mdtStaff: { staffId: string; role: string }[] = [];

      // Resolve the team org_unit_id: first from episode.team_id, then from patient_team_assignments
      let teamOrgUnitId = activeEpisode.team_id ?? null;
      if (!teamOrgUnitId) {
        const pta = await db('patient_team_assignments')
          .where({ patient_id: patientId, is_active: true })
          .orderBy('created_at', 'desc')
          .first();
        teamOrgUnitId = pta?.org_unit_id ?? null;
      }

      // Look up MDT staff from staff_role_assignments for the team
      if (teamOrgUnitId) {
        const roleAssignments = await db('staff_role_assignments')
          .join('clinical_roles', 'clinical_roles.id', 'staff_role_assignments.clinical_role_id')
          .where('staff_role_assignments.org_unit_id', teamOrgUnitId)
          .where('staff_role_assignments.is_active', true)
          .whereIn('clinical_roles.name', ['Psychiatry Registrar', 'Consultant Psychiatrist', 'Senior Clinician'])
          .select('staff_role_assignments.staff_id', 'clinical_roles.name as role_name');

        for (const ra of roleAssignments) {
          // Bug fix: SELECT alias is `as role_name` (snake_case, line 376),
          // so the field on the row object is `role_name`, not `rolename`.
          // Prior code pushed `role: undefined` for every MDT pathology task.
          mdtStaff.push({ staffId: ra.staff_id, role: ra.role_name });
        }
      }

      // If no role assignments found, fall back to episode's primary clinician
      if (mdtStaff.length === 0 && activeEpisode.primary_clinician_id) {
        mdtStaff.push({ staffId: activeEpisode.primary_clinician_id, role: 'Primary Clinician' });
      }

      // Create a review task for each relevant MDT member
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3); // 3 day review window

      for (const staff of mdtStaff) {
        // Tasks schema: assigned_by_id (not created_by_id), due_date
        // (not due_at), status 'pending' (not 'todo') — verified via
        // psql \d tasks. Same bug class as SD1. This was one of the
        // real causes of the user-reported "pathology upload fails".
        const task = await createTaskInternal(clinicId, req.user!.id, {
          patientId,
          episodeId: activeEpisode.id,
          assignedToId: staff.staffId,
          title: `Review pathology report: ${investigationType || 'Report'} — ${patientName}`,
          description: `A new ${investigationType || 'pathology'} report has been uploaded for ${patientName} on ${reportDate || new Date().toISOString().split('T')[0]}. Please review and approve.${notes ? `\n\nNotes: ${notes}` : ''}`,
          priority: 'medium',
          taskType: 'pathology_review',
          dueDate: dueDate.toISOString().slice(0, 10),
        })
        tasksCreated.push(task.id);
      }
    }

    // Create tasks for additional assignees (from frontend dialog)
    const additionalRaw = req.body.additionalAssignees;
    const additionalAssignees: string[] = additionalRaw ? (typeof additionalRaw === 'string' ? JSON.parse(additionalRaw) : additionalRaw) : [];
    if (additionalAssignees.length > 0) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 3);
      const existingIds = new Set(tasksCreated.map(String));
      for (const staffId of additionalAssignees) {
        if (existingIds.has(staffId)) continue;
        try {
          const task = await createTaskInternal(clinicId, req.user!.id, {
            patientId,
            episodeId: activeEpisode?.id ?? undefined,
            assignedToId: staffId,
            title: `Review pathology report: ${investigationType || 'Report'} — ${patientName}`,
            description: `A new ${investigationType || 'pathology'} report has been uploaded for ${patientName}. Please review.${notes ? `\n\nNotes: ${notes}` : ''}`,
            priority: 'medium',
            taskType: 'pathology_review',
            dueDate: dueDate.toISOString().slice(0, 10),
          })
          tasksCreated.push(task.id);
        } catch (err) {
          // Log but don't fail the upload — additional assignees are
          // optional. Silent catch was hiding the "column doesn't exist"
          // error that caused SD1.
          logger.warn({ err, staffId }, 'Additional pathology task insert failed');
        }
      }
    }

    res.status(201).json({
      ok: true,
      attachmentId,
      tasksCreated: tasksCreated.length,
      message: tasksCreated.length > 0
        ? `Report uploaded. ${tasksCreated.length} review task(s) created for MDT.`
        : 'Report uploaded. No active episode found — no review tasks created.',
    });
  } catch (err) { next(err); }
});

router.get('/:id/pathology', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // BUG-368: clinic_id Layer-1 tenant isolation (see §1.3).
    const rows = await db('patient_attachments')
      .where({ patient_id: req.params.id, clinic_id: req.clinicId, is_active: true })
      .whereRaw("label LIKE 'Pathology:%'")
      .orderBy('created_at', 'desc');
    const reports = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        filename: r.filename,
        label: r.label,
        mimetype: r.mime_type,
        filesize: r.file_size,
        filePath: r.file_path,
        downloadUrl: await resolveAttachmentDownloadUrl(r),
        createdAt: r.created_at,
      })),
    );
    res.json({ reports });
  } catch (err) { next(err); }
});

router.get('/:id/notes', requireClinicalPatientAccess('note:read', 'read'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // BUG-430: qualified-column clinic_id matches the JOIN style.
    const rows = await db('clinical_notes')
      .leftJoin('staff as author', 'author.id', 'clinical_notes.author_id')
      .leftJoin('staff as signer', 'signer.id', 'clinical_notes.signed_by_id')
      .leftJoin('episodes', 'episodes.id', 'clinical_notes.episode_id')
      .where('clinical_notes.patient_id', req.params.id)
      .where('clinical_notes.clinic_id', req.clinicId)
      .whereNull('clinical_notes.deleted_at')
      .select(
        'clinical_notes.*',
        db.raw("COALESCE(author.given_name || ' ' || author.family_name, '') as author_name"),
        'author.digital_signature as author_signature',
        db.raw("COALESCE(signer.given_name || ' ' || signer.family_name, '') as signed_by_name"),
        'episodes.presenting_problem as episode_title',
        'episodes.episode_type as episode_type',
      )
      .orderBy('clinical_notes.created_at', 'desc');
    const episodeId = req.query.episodeId as string | undefined;
    const noteType = req.query.type as string | undefined;
    let filtered = episodeId ? rows.filter((r) => r.episode_id === episodeId) : rows;
    if (noteType) filtered = filtered.filter((r) => r.note_type === noteType);
    res.json({ notes: filtered.map(mapClinicalNoteListRowToResponse) });
  } catch (err) { next(err); }
});
router.post('/:id/notes', requireClinicalPatientAccess('note:create'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateClinicalNoteInlineSchema.parse(req.body);
    const auth = buildAuthContext(req);
    const { episodeId, consentId, templateId, title, noteType, content, foiContent, foiExempt, status, didNotAttend, isReportableContact, contactMeta } = dto;

    // Intentionally allow new artifact note versions after sign-off.
    // Sign-off lock applies to PATCH (mutation of an existing artifact),
    // not POST (append-only new version).

    // Auto-assign active episode if not provided
    let resolvedEpisodeId = episodeId ?? null;
    if (!resolvedEpisodeId) {
      const activeEp = await db('episodes').where({ patient_id: req.params.id, clinic_id: req.clinicId, status: 'open' }).whereNull('deleted_at').orderBy('created_at', 'desc').first();
      resolvedEpisodeId = activeEp?.id ?? null;
    }
    const isSigned = status === 'signed';
    const isAiDraft = dto.isAiDraft === true;
    const { blocked, requiresReviewedAndAdopted } = await enforceAiDraftSignAttestationOrRespond({
      auth,
      isSigning: isSigned,
      isAiDraft,
      reviewedAndAdopted: dto.reviewedAndAdopted,
    });
    if (blocked) {
      return;
    }
    const firstVisitCreate = await resolveFirstVisitCreateContactMeta({
      dbConn: db as unknown as Knex,
      auth,
      patientId: req.params.id,
      noteType: noteType ?? 'progress',
      isSigning: isSigned,
      attestation: dto.firstVisitChartReview,
      contactMeta,
      staffId: req.user?.id ?? null,
    });
    if (firstVisitCreate.blocked) {
      return;
    }
    const recentRiskGate = await evaluateRecentRiskAssessmentSignGate({
      dbConn: db as unknown as Knex,
      auth,
      patientId: req.params.id,
      noteType: noteType ?? 'progress',
      isSigning: isSigned,
    });
    if (
      recentRiskGate.requiresRecentRiskAssessment &&
      !recentRiskGate.hasRecentRiskAssessment
    ) {
      respondRecentRiskAssessmentRequired();
      return;
    }

    const [row] = await db('clinical_notes').insert({
      id: db.raw('gen_random_uuid()'), clinic_id: req.clinicId, patient_id: req.params.id,
      consent_id: await ensureClinicalNoteConsent({ clinicId: req.clinicId, patientId: req.params.id, clinicianId: req.user?.id ?? null, consentId }),
      episode_id: resolvedEpisodeId, template_id: templateId ?? null,
      author_id: req.user?.id ?? null, title, note_type: noteType ?? 'progress',
      content: content ?? null, foi_content: foiContent ?? null, foi_exempt: foiExempt ?? false,
      status: isSigned ? 'signed' : 'draft', did_not_attend: didNotAttend ?? false,
      is_reportable_contact: isReportableContact ?? true,
      is_ai_draft: isAiDraft,
      contact_meta: firstVisitCreate.contactMeta ? JSON.stringify(firstVisitCreate.contactMeta) : null,
      signed_by_id: isSigned ? req.user?.id ?? null : null,
      signed_at: isSigned ? new Date() : null,
      ...reviewedAndAdoptedPatch(requiresReviewedAndAdopted, req.user?.id ?? null),
      created_at: new Date(), updated_at: new Date(),
    }).returning(CLINICAL_NOTE_COLUMNS);
    try {
      const { createAutoContactRecord } = await import('../contacts/autoContactRecord');
      await createAutoContactRecord({
        clinicId: req.clinicId,
        patientId: req.params.id,
        episodeId: resolvedEpisodeId ?? undefined,
        staffId: req.user?.id ?? '',
        sourceType: 'clinical_note',
        sourceId: row.id,
        briefSummary: `${noteType ?? 'progress'} note`,
      });
    } catch { /* non-blocking */ }
    res.status(201).json({ note: mapClinicalNoteRowToResponse(row) });
  } catch (err) { next(err); }
});
import { optimisticLock } from '../../middleware/optimisticLockMiddleware';
router.patch('/:id/notes/:noteId', requireClinicalPatientAccess('note:update'), optimisticLock('clinical_notes', 'noteId'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = UpdateClinicalNoteInlineSchema.parse(req.body);
    const auth = buildAuthContext(req);
    // Only drafts can be edited
    const existing = await db('clinical_notes').where({ id: req.params.noteId, clinic_id: req.clinicId }).whereNull('deleted_at').first();
    if (!existing) { return next(new AppError('Not found', 404, 'NOT_FOUND')); }
    if (existing.patient_id !== req.params.id) {
      return next(new AppError('Not found', 404, 'NOT_FOUND'));
    }
    if (existing.status === 'signed') { res.status(400).json({ error: 'Signed notes cannot be edited' }); return; }

    // Lock persisted AI summary artifacts after consultant signoff so
    // longitudinal/formulation/diagnosis/lifechart snapshots cannot be reset.
    const sectionsToCheck = new Set<SummaryArtifactSection>();
    const existingSection = mapSummarySectionForNoteType(existing.note_type);
    if (existingSection) sectionsToCheck.add(existingSection);
    const incomingSection = mapSummarySectionForNoteType(dto.noteType);
    if (incomingSection) sectionsToCheck.add(incomingSection);
    await assertSummarySectionsUnlocked({
      clinicId: req.clinicId,
      patientId: req.params.id,
      sections: [...sectionsToCheck],
    });

    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.content !== undefined) patch.content = dto.content;
    if (dto.soapSubjective !== undefined) patch.soap_subjective = dto.soapSubjective;
    if (dto.soapObjective !== undefined) patch.soap_objective = dto.soapObjective;
    if (dto.soapAssessment !== undefined) patch.soap_assessment = dto.soapAssessment;
    if (dto.soapPlan !== undefined) patch.soap_plan = dto.soapPlan;
    if (dto.foiContent !== undefined) patch.foi_content = dto.foiContent;
    if (dto.foiExempt !== undefined) patch.foi_exempt = dto.foiExempt;
    if (dto.didNotAttend !== undefined) patch.did_not_attend = dto.didNotAttend;
    if (dto.isReportableContact !== undefined) patch.is_reportable_contact = dto.isReportableContact;
    if (dto.contactMeta !== undefined) patch.contact_meta = JSON.stringify(dto.contactMeta);
    if (dto.episodeId !== undefined) patch.episode_id = dto.episodeId;
    if (dto.noteType !== undefined) patch.note_type = dto.noteType;
    if (dto.isAiDraft !== undefined) patch.is_ai_draft = dto.isAiDraft;

    if (dto.status === 'signed') {
      const { blocked, requiresReviewedAndAdopted } = await enforceAiDraftSignAttestationOrRespond({
        auth,
        isSigning: true,
        isAiDraft: existing.is_ai_draft === true,
        reviewedAndAdopted: dto.reviewedAndAdopted,
      });
      if (blocked) {
        return;
      }
      const firstVisitPatch = await resolveFirstVisitSignPatch({
        dbConn: db as unknown as Knex,
        auth,
        patientId: req.params.id,
        noteType: dto.noteType ?? existing.note_type,
        attestation: dto.firstVisitChartReview,
        currentNoteId: req.params.noteId,
        sourceContactMeta: dto.contactMeta !== undefined ? dto.contactMeta : existing.contact_meta,
        staffId: req.user?.id ?? null,
      });
      if (firstVisitPatch.blocked) {
        return;
      }
      const recentRiskGate = await evaluateRecentRiskAssessmentSignGate({
        dbConn: db as unknown as Knex,
        auth,
        patientId: req.params.id,
        noteType: dto.noteType ?? existing.note_type,
        isSigning: true,
        currentNoteId: req.params.noteId,
      });
      if (
        recentRiskGate.requiresRecentRiskAssessment &&
        !recentRiskGate.hasRecentRiskAssessment
      ) {
        respondRecentRiskAssessmentRequired();
        return;
      }
      if (firstVisitPatch.contactMetaPatch) {
        patch.contact_meta = JSON.stringify(firstVisitPatch.contactMetaPatch);
      }
      patch.status = 'signed';
      patch.signed_by_id = req.user?.id ?? null;
      patch.signed_at = new Date();
      Object.assign(patch, reviewedAndAdoptedPatch(requiresReviewedAndAdopted, req.user?.id ?? null));
    }

    const [row] = await db('clinical_notes').where({ id: req.params.noteId, clinic_id: req.clinicId }).whereNull('deleted_at').update(patch).returning(CLINICAL_NOTE_COLUMNS);

    if (dto.status === 'signed' && row) {
      try {
        const { workflowEvents } = await import('../workflows/workflowEvents');
        workflowEvents.emitWorkflow('note_signed', { clinicId: req.clinicId, patientId: row.patient_id, noteId: row.id, staffId: req.user?.id });
      } catch { /* workflow engine may not be loaded */ }
    }

    res.json({ note: mapClinicalNoteRowToResponse(row) });
  } catch (err) { next(err); }
});

router.delete('/:id/notes/:noteId', requireClinicalPatientAccess('note:update'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req, req.params.id);
    const { clinicalNoteService } = await import('../clinical-notes/clinicalNote.service');
    await clinicalNoteService.softDelete(auth, req.params.noteId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

registerPatientAncillaryRoutes(router, { upload });

// Deactivate/reactivate routes are in patientStatusRoutes.ts (mounted separately in server.ts)

router.get('/:id', patientController.getById);
router.patch('/:id', patientController.update);
router.post('/', patientController.create);
router.put('/:id', patientController.update);
router.delete('/:id', patientController.softDelete);

export default router;
