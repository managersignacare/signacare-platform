/**
 * Patient App (Viva) API Routes
 *
 * Clinician-side:
 *   POST /patient-app/invite/:patientId  — Generate invite code
 *   GET  /patient-app/invite/:patientId  — Get active invite for patient
 *
 * Patient-side (no auth required):
 *   POST /patient-app/activate           — Redeem code + set password
 *   POST /patient-app/login              — Patient login (phone + password)
 *
 * Patient-side (auth required):
 *   GET  /patient-app/me                 — Get patient profile
 *   POST /patient-app/tracking           — Submit tracking data (mood, vitals, meds)
 *   GET  /patient-app/tracking/:patientId — Get tracking data (clinician or patient)
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  DigitalPhenotypeRowsResponseSchema,
  MicroLearningAssignmentListResponseSchema,
  MicroLearningCardSchema,
  PathwayDigitalInterventionBundleSchema,
  PathwayPatientInterventionsResponseSchema,
  RecordRoutineEventSchema,
  WearableDeviceSourceCreateResponseSchema,
  WearableDeviceSourceListResponseSchema,
  WearableIngestOutcomeSchema,
  WearableSurveillanceSnapshotSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import {
  patientActivateCodeLimiter,
  patientAuthLimiter,
  patientLoginPhoneLimiter,
} from '../../middleware/rateLimiters';
import { requirePatientOwnership } from '../../shared/authGuards';
import { dbAdmin } from '../../db/db';
import { logger } from '../../utils/logger';
import { resolveAttachmentDownloadUrl } from '../../shared/blobStorage';
import { detectSuicideRiskSignal } from '../../shared/assessmentRisk';
import { createTaskInternal } from '../tasks/taskService';
import { emitClinicalSignal } from '../events/clinicalSignalEmitter';
import { AppError } from '../../shared/errors';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { behavioralEngagementService } from '../treatment-pathways/behavioralEngagementService';
import { PATIENT_INVITES_COLUMNS } from '../../db/types/patient_invites';
import { PATIENT_MED_REMINDERS_COLUMNS } from '../../db/types/patient_med_reminders';
import { PATIENT_SHARED_DOCUMENTS_COLUMNS } from '../../db/types/patient_shared_documents';
import { VIVA_ALERT_THRESHOLDS_COLUMNS } from '../../db/types/viva_alert_thresholds';
import { OUTCOME_MEASURES_COLUMNS } from '../../db/types/outcome_measures';
import { PATIENT_TASKS_COLUMNS } from '../../db/types/patient_tasks';
import { APPOINTMENT_CHECKLISTS_COLUMNS } from '../../db/types/appointment_checklists';
import type {
  TrackingQueryRow,
  MedReminderQueryRow,
  SharedDocumentQueryRow,
} from './patientAppRouteTypes';
import {
  mapMedReminderRowToResponse,
  mapSharedDocumentRowToResponse,
  MedRemindersResponseSchema,
  SharedDocumentsResponseSchema,
} from './patientAppRouteTypes';
import {
  ActivateSchema,
  AlertThresholdSchema,
  AssessmentStartSchema,
  AssessmentSubmitSchema,
  ChecklistItemCreateSchema,
  ChecklistItemToggleSchema,
  DocumentUploadSchema,
  MedReminderSchema,
  PatientMessageCreateSchema,
  PatientMessageReplySchema,
  PatientLoginSchema,
  PatientInterventionItemCompletionSchema,
  PatientSleepCheckInSubmissionSchema,
  PatientThoughtDiarySubmissionSchema,
  PatientWearableIngestSchema,
  PatientWearableSourceCreateSchema,
  RegisterDeviceSchema,
  SingleTrackingSchema,
  SyncPreferenceSchema,
  TaskCreateSchema,
  TaskStatusSchema,
  TrackingBatchSchema,
  TriageNumberSchema,
  TriageResponseSchema,
  type TrackingEntryInput,
} from './patientAppSchemas';
import {
  handlePatientAppRegistration,
  normalizeDobInput,
} from './patientAppRegistrationRoutes';
import { pathwayRepository } from '../treatment-pathways/pathwayRepository';
import { pathwayService } from '../treatment-pathways/pathwayService';
import { digitalPhenotypingService } from '../treatment-pathways/digitalPhenotypingService';
import { classifyTemplate } from '../assessments/assessmentRegistry';
import {
  findClinicSelfRatingDefinition,
  listClinicSelfRatingDefinitions,
} from './patientAppSelfRatingSupport';

type TrackingBatchEntry = TrackingEntryInput & {
  type?: string;
  timestamp?: string;
};

const router = Router();
const UnknownRecordSchema = z.record(z.string(), z.unknown());
const AttachmentsResponseSchema = z.object({ attachments: z.array(UnknownRecordSchema) });
const PathologyResultsResponseSchema = z.object({ results: z.array(UnknownRecordSchema) });
const MessagesResponseSchema = z.object({ messages: z.array(UnknownRecordSchema) });
const PatientMessageCreatedResponseSchema = z.object({
  id: z.string(),
  threadId: z.string().nullable(),
  createdAt: z.string().nullable(),
});
const AppointmentsResponseSchema = z.object({ appointments: z.array(UnknownRecordSchema) });
const EpisodesResponseSchema = z.object({ data: z.array(UnknownRecordSchema) });
const EpisodeAllocationResponseSchema = z.object({
  episodeId: z.string(),
  orgUnitId: z.string().nullable(),
  teamName: z.string().nullable(),
  primaryClinicianId: z.string().nullable(),
  mdt: z.array(UnknownRecordSchema),
});
const TrackingEntriesResponseSchema = z.object({ entries: z.array(UnknownRecordSchema) });
const SelfRatingTemplateResponseSchema = UnknownRecordSchema.and(z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  templateId: z.string().uuid().nullable().optional(),
}));
const SelfRatingTemplatesResponseSchema = z.object({
  templates: z.array(SelfRatingTemplateResponseSchema),
});
const PatientAssignedAssessmentResponseSchema = z.object({
  assessment: UnknownRecordSchema,
});
const MobileSyncResponseSchema = z.object({
  notifications: z.array(UnknownRecordSchema),
  appointments: z.array(UnknownRecordSchema),
  outreachLog: z.array(UnknownRecordSchema),
  documents: z.array(UnknownRecordSchema),
  lastSyncAt: z.string().datetime(),
  preferencesSnapshot: z.record(z.boolean()),
});
const PatientMicroLearningResponseSchema = z.object({
  assignments: MicroLearningAssignmentListResponseSchema.shape.assignments,
  cards: z.array(MicroLearningCardSchema),
});
const PatientMicroLearningStatusSchema = z.object({
  status: z.enum(['opened', 'completed']),
});
function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function resolveActivationCodeInput(rawBody: unknown): string | null {
  const body = (rawBody && typeof rawBody === 'object')
    ? rawBody as Record<string, unknown>
    : {};
  const candidates = [
    body.code,
    body.inviteCode,
    body.invitationToken,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function normalizeActivationCode(input: string): string {
  const trimmed = input.trim();
  // Accept common clinician/patient formatting (e.g. "123 456").
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 6) return digitsOnly;
  return trimmed;
}

async function generateUniquePatientInviteCode(): Promise<string> {
  const MAX_ATTEMPTS = 20;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    const candidate = String(Math.floor(100000 + Math.random() * 900000));
    const existing = await dbAdmin('patient_invites')
      .where({ code: candidate })
      .whereNull('used_at')
      .where('expires_at', '>', new Date())
      .first('id');
    if (!existing) return candidate;
  }
  throw new AppError(
    'Unable to generate a unique activation code. Please retry.',
    503,
    'PATIENT_INVITE_CODE_GENERATION_FAILED',
  );
}

function toPathwayAuthContext(req: Request): { clinicId: string; staffId: string; role: string; permissions: string[] } {
  return {
    clinicId: req.clinicId!,
    staffId: req.user!.id,
    role: req.user?.role ?? 'patient',
    permissions: Array.isArray(req.user?.permissions) ? req.user!.permissions : [],
  };
}

async function assertPathwaysModuleEnabled(clinicId: string): Promise<void> {
  const row = await dbAdmin('clinic_modules')
    .where({ clinic_id: clinicId, module_key: MODULE_KEYS.PATHWAYS })
    .first('is_enabled');
  if (row && row['is_enabled'] === false) {
    throw new AppError(
      `Module '${MODULE_KEYS.PATHWAYS}' is disabled for this clinic`,
      403,
      'MODULE_DISABLED',
    );
  }
}

async function resolvePathwayForPatient(
  clinicId: string,
  patientId: string,
  pathwayId?: string,
): Promise<{ id: string }> {
  if (pathwayId) {
    const row = await pathwayRepository.findById(clinicId, pathwayId);
    if (!row || row.patient_id !== patientId) {
      throw new AppError('Treatment pathway not found for patient', 404, 'PATHWAY_NOT_FOUND');
    }
    return { id: row.id };
  }

  const rows = await pathwayRepository.listForPatient(clinicId, patientId);
  const active = rows.find((row) => row.status === 'active');
  if (active) return { id: active.id };
  const fallback = rows[0];
  if (fallback) return { id: fallback.id };
  throw new AppError('No treatment pathway found for patient', 404, 'PATHWAY_NOT_FOUND');
}

router.post('/register', patientAuthLimiter, handlePatientAppRegistration);

router.post('/invite/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const clinicId = req.clinicId;
    const patientId = req.params.patientId;
    const staffId = req.user!.id;

    const patient = await dbAdmin('patients').where({ id: patientId, clinic_id: clinicId }).first();
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');

    await dbAdmin('patient_invites')
      .where({ patient_id: patientId, clinic_id: clinicId })
      .whereNull('used_at')
      .update({ used_at: new Date() });

    const code = await generateUniquePatientInviteCode();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    const [invite] = await dbAdmin('patient_invites').insert({
      clinic_id: clinicId,
      patient_id: patientId,
      code,
      expires_at: expiresAt,
      created_by: staffId,
    }).returning(PATIENT_INVITES_COLUMNS);

    logger.info({ patientId, code, staffId }, 'Viva invite generated');

    res.status(201).json({
      code: invite.code,
      qrToken: invite.qr_token,
      expiresAt: invite.expires_at,
      patientName: `${patient.given_name} ${patient.family_name}`,
    });
  } catch (err) { next(err); }
});

router.get('/invite/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const invite = await dbAdmin('patient_invites')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .whereNull('used_at')
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .first();

    if (!invite) { res.json({ invite: null }); return; }

    const account = await dbAdmin('patient_app_accounts')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .first();

    res.json({
      invite: {
        code: invite.code,
        qrToken: invite.qr_token,
        expiresAt: invite.expires_at,
        createdAt: invite.created_at,
      },
      hasAccount: !!account,
      accountActive: account?.is_active ?? false,
      lastLogin: account?.last_login_at ?? null,
    });
  } catch (err) { next(err); }
});


router.post('/activate', patientAuthLimiter, patientActivateCodeLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const canonicalCode = resolveActivationCodeInput(req.body);
    if (!canonicalCode) {
      throw new AppError('Activation code is required', 400, 'VALIDATION_ERROR');
    }
    const { code, password, dob, phone } = ActivateSchema.parse({
      ...((req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {}),
      code: canonicalCode,
    });
    const normalizedCode = normalizeActivationCode(code);

    const inviteCandidates = await dbAdmin('patient_invites')
      .where({ code: normalizedCode })
      .whereNull('used_at')
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(2);

    const invite = inviteCandidates[0];

    if (!invite) {
      throw new AppError('Invalid or expired code. Please ask your clinician for a new code.', 400, 'INVALID_ACTIVATION_CODE');
    }
    if (inviteCandidates.length > 1) {
      logger.warn(
        { code: normalizedCode, inviteCount: inviteCandidates.length },
        'Multiple active patient invites share one code; newest invite selected',
      );
    }

    if (dob) {
      const patient = await dbAdmin('patients').where({ id: invite.patient_id, clinic_id: invite.clinic_id }).first();
      if (patient?.date_of_birth) {
        const patientDob = new Date(patient.date_of_birth).toISOString().split('T')[0];
        const normalizedDob = normalizeDobInput(dob);
        if (!normalizedDob) {
          throw new AppError('Date of birth must be YYYY-MM-DD or DD/MM/YYYY', 400, 'VALIDATION_ERROR');
        }
        const providedDob = new Date(normalizedDob).toISOString().split('T')[0];
        if (patientDob !== providedDob) {
          throw new AppError('Date of birth does not match our records', 400, 'DOB_MISMATCH');
        }
      }
    }

    const cleanPhone = String(phone).trim();

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    const existing = await dbAdmin('patient_app_accounts')
      .where({ patient_id: invite.patient_id, clinic_id: invite.clinic_id })
      .first();

    if (existing) {
      await dbAdmin('patient_app_accounts')
        .where({ id: existing.id })
        .update({ password_hash: passwordHash, phone: cleanPhone, is_active: true, updated_at: new Date() });
    } else {
      await dbAdmin('patient_app_accounts').insert({
        clinic_id: invite.clinic_id,
        patient_id: invite.patient_id,
        phone: cleanPhone,
        password_hash: passwordHash,
      });
    }

    await dbAdmin('patient_invites').where({ id: invite.id, clinic_id: invite.clinic_id }).update({ used_at: new Date() });

    logger.info({ patientId: invite.patient_id }, 'Viva account activated');

    res.json({
      ok: true,
      message: 'Account activated! You can now sign in with your phone number.',
      phone: cleanPhone ? `${cleanPhone.substring(0, 4)}****${cleanPhone.slice(-2)}` : null,
    });
  } catch (err) { next(err); }
});


router.post('/login', patientAuthLimiter, patientLoginPhoneLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, password } = PatientLoginSchema.parse(req.body);

    if (!phone || !password) {
      throw new AppError('Phone and password are required', 400, 'VALIDATION_ERROR');
    }

    const account = await dbAdmin('patient_app_accounts')
      .where({ phone: phone.trim() })
      .where({ is_active: true })
      .first();

    if (!account) {
      throw new AppError('Invalid phone number or password', 401, 'INVALID_CREDENTIALS');
    }

    if (account.locked_until && new Date(account.locked_until) > new Date()) {
      throw new AppError('Account locked. Try again later.', 429, 'PATIENT_ACCOUNT_LOCKED');
    }

    const bcrypt = await import('bcryptjs');
    const valid = await bcrypt.compare(password, account.password_hash);

    if (!valid) {
      const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
      await dbAdmin('patient_app_accounts')
        .where({ id: account.id, clinic_id: account.clinic_id })
        .update({
          failed_login_attempts: dbAdmin.raw('COALESCE(failed_login_attempts, 0) + 1'),
          locked_until: dbAdmin.raw(
            'CASE WHEN COALESCE(failed_login_attempts, 0) + 1 >= 5 THEN ? ELSE NULL END',
            [lockUntil],
          ),
        });
      throw new AppError('Invalid phone number or password', 401, 'INVALID_CREDENTIALS');
    }

    await dbAdmin('patient_app_accounts')
      .where({ id: account.id, clinic_id: account.clinic_id })
      .update({ failed_login_attempts: 0, locked_until: null, last_login_at: new Date() });

    const patient = await dbAdmin('patients').where({ id: account.patient_id, clinic_id: account.clinic_id }).first();

    const jwt = await import('jsonwebtoken');
    const { config } = await import('../../config');
    const tokenPayload = {
      id: account.id,
      patientId: account.patient_id,
      clinicId: account.clinic_id,
      givenName: patient?.given_name,
      familyName: patient?.family_name,
      role: 'patient',
      isPatientApp: true,
    };
    const accessToken = jwt.default.sign(tokenPayload, config.jwt.accessSecret, { expiresIn: '4h' });
    const refreshToken = jwt.default.sign(
      { sub: account.id, patientId: account.patient_id, clinicId: account.clinic_id },
      config.jwt.refreshSecret ?? config.jwt.accessSecret,
      { expiresIn: '30d' }
    );

    try {
      const { primeIdleWindow, effectiveIdleMinutesForClinic } = await import('../../middleware/sessionIdleMiddleware');
      const staffId = account.id as string;
      const clinicIdForIdle = (account.clinic_id ?? account.clinicId) as string;
      effectiveIdleMinutesForClinic(clinicIdForIdle)
        .then((minutes) => primeIdleWindow(staffId, minutes))
        .catch((err: unknown) => {
          logger.warn(
            { err, op: 'prime', staffId, surface: 'patient-app' },
            'sessionIdleMiddleware.primeIdleWindow failed — patient-app idle tracking is degraded',
          );
        });
    } catch (err) {
      logger.warn(
        {
          err,
          kind: 'session_middleware_load_failure',
          staffId: account.id,
          clinicId: account.clinic_id,
          surface: 'patient-app',
        },
        'BUG-517: failed to load sessionIdleMiddleware for patient-app login; idle tracking is degraded',
      );
    }

    res.json({
      user: {
        id: account.id,
        patientId: account.patient_id,
        clinicId: account.clinic_id,
        givenName: patient?.given_name,
        familyName: patient?.family_name,
        phoneMobile: account.phone,
        email: account.email,
        role: 'patient',
      },
      accessToken,
      refreshToken,
    });
  } catch (err) { next(err); }
});


router.get('/me', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    const patientId = user?.patientId ?? user?.id;
    const patient = await dbAdmin('patients').where({ id: patientId }).first();
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');

    res.json({
      id: user?.id,
      patientId: patient.id,
      clinicId: patient.clinic_id,
      givenName: patient.given_name,
      familyName: patient.family_name,
      dateOfBirth: patient.date_of_birth,
      phoneMobile: patient.phone_mobile,
      email: patient.email_primary,
      role: 'patient',
    });
  } catch (err) { next(err); }
});

router.post('/logout', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.user?.id) {
      try {
        const { clearIdleWindow } = await import('../../middleware/sessionIdleMiddleware');
        await clearIdleWindow(req.user.id);
      } catch (err) {
        logger.warn(
          { err, userId: req.user.id, surface: 'patient-app' },
          'patient-app logout idle-window clear failed',
        );
      }
    }
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/medications/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin('patient_medications')
      .where({
        clinic_id: req.clinicId,
        patient_id: req.params.patientId,
      })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc')
      .select(
        'id',
        'drug_label',
        'generic_name',
        'dose',
        'route',
        'frequency',
        'status',
        'start_date',
        'end_date',
        'instructions',
        'is_lai',
      ) as Array<{
      id: string;
      drug_label: string | null;
      generic_name: string | null;
      dose: string | null;
      route: string | null;
      frequency: string | null;
      status: string | null;
      start_date: Date | string | null;
      end_date: Date | string | null;
      instructions: string | null;
      is_lai: boolean | null;
    }>;

    res.json({
      medications: rows.map((row) => ({
        id: row.id,
        drugLabel: row.drug_label,
        genericName: row.generic_name,
        dose: row.dose,
        route: row.route,
        frequency: row.frequency,
        status: row.status,
        startDate: toIsoString(row.start_date),
        endDate: toIsoString(row.end_date),
        instructions: row.instructions,
        isLai: row.is_lai ?? false,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/attachments/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin('patient_attachments')
      .where({
        clinic_id: req.clinicId,
        patient_id: req.params.patientId,
        is_active: true,
      })
      .orderBy('created_at', 'desc');

    const attachments = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        filename: row.filename,
        label: row.label,
        mimeType: row.mime_type,
        fileSize: row.file_size,
        filePath: row.file_path,
        createdAt: toIsoString(row.created_at),
        uploadedAt: toIsoString(row.created_at),
        downloadUrl: await resolveAttachmentDownloadUrl(row),
      })),
    );

    res.json(AttachmentsResponseSchema.parse({ attachments }));
  } catch (err) { next(err); }
});

router.get('/pathology/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);

    const labRows = await dbAdmin('pathology_results')
      .where({
        clinic_id: req.clinicId,
        patient_id: req.params.patientId,
      })
      .orderBy('result_date', 'desc')
      .limit(250)
      .select(
        'id',
        'test_name',
        'result_value',
        'result_unit',
        'abnormal_flag',
        'is_critical',
        'result_date',
        'collection_date',
      ) as Array<{
      id: string;
      test_name: string | null;
      result_value: string | number | null;
      result_unit: string | null;
      abnormal_flag: string | null;
      is_critical: boolean | null;
      result_date: Date | string | null;
      collection_date: Date | string | null;
    }>;

    const reportRows = await dbAdmin('patient_attachments')
      .where({
        clinic_id: req.clinicId,
        patient_id: req.params.patientId,
        is_active: true,
      })
      .whereRaw("label LIKE 'Pathology:%'")
      .orderBy('created_at', 'desc')
      .limit(100);

    const reportItems = await Promise.all(
      reportRows.map(async (row) => ({
        id: row.id as string,
        testName: String(row.label ?? row.filename ?? 'Pathology report'),
        result: 'Attachment report',
        units: null as string | null,
        isAbnormal: false,
        isCritical: false,
        createdAt: toIsoString(row.created_at),
        downloadUrl: await resolveAttachmentDownloadUrl(row),
      })),
    );

    const results = [
      ...labRows.map((row) => ({
        id: row.id,
        testName: row.test_name ?? 'Pathology result',
        result: row.result_value == null ? null : String(row.result_value),
        units: row.result_unit,
        isAbnormal: row.is_critical === true || String(row.abnormal_flag ?? '').trim().length > 0,
        isCritical: row.is_critical === true,
        resultDate: toIsoString(row.result_date),
        collectionDate: toIsoString(row.collection_date),
      })),
      ...reportItems,
    ];

    res.json(PathologyResultsResponseSchema.parse({ results }));
  } catch (err) { next(err); }
});

router.get('/legal-orders/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);

    const rows = await dbAdmin('legal_orders as lo')
      .leftJoin('legal_order_types as lot', 'lot.id', 'lo.order_type_id')
      .where('lo.clinic_id', req.clinicId)
      .andWhere('lo.patient_id', req.params.patientId)
      .whereNull('lo.deleted_at')
      .orderBy('lo.start_date', 'desc')
      .select(
        'lo.id',
        'lo.order_number',
        'lo.status',
        'lo.start_date',
        'lo.expires_at',
        'lo.review_date',
        'lo.issuing_authority',
        'lo.notes',
        'lot.name as order_type_name',
      ) as Array<{
      id: string;
      order_number: string | null;
      status: string | null;
      start_date: Date | string | null;
      expires_at: Date | string | null;
      review_date: Date | string | null;
      issuing_authority: string | null;
      notes: string | null;
      order_type_name: string | null;
    }>;

    res.json({
      orders: rows.map((row) => ({
        id: row.id,
        orderType: row.order_type_name ?? row.order_number ?? 'Legal order',
        type: row.order_type_name ?? row.order_number ?? 'Legal order',
        status: row.status ?? 'active',
        hearingDate: toIsoString(row.review_date),
        startDate: toIsoString(row.start_date),
        expiresAt: toIsoString(row.expires_at),
        issuingAuthority: row.issuing_authority,
        notes: row.notes,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/messages/inbox', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const patientIdRaw = req.user?.patientId ?? (typeof req.query.patientId === 'string' ? req.query.patientId : null);
    if (!patientIdRaw) {
      throw new AppError('patientId is required', 400, 'VALIDATION_ERROR');
    }
    await requirePatientOwnership(req, patientIdRaw);

    const patient = await dbAdmin('patients')
      .where({ id: patientIdRaw, clinic_id: req.clinicId })
      .first('given_name', 'family_name');
    const patientDisplayName = [patient?.given_name, patient?.family_name]
      .filter((segment): segment is string => Boolean(segment && segment.trim()))
      .join(' ')
      .trim() || 'You';

    const rows = await dbAdmin('messages as m')
      .join('message_threads as mt', function () {
        this.on('mt.id', 'm.thread_id').andOn('mt.clinic_id', 'm.clinic_id');
      })
      .leftJoin('staff as s', function () {
        this.on('s.id', 'm.sender_id').andOn('s.clinic_id', 'm.clinic_id');
      })
      .where('m.clinic_id', req.clinicId)
      .andWhere('mt.patient_id', patientIdRaw)
      .orderBy('m.created_at', 'desc')
      .limit(250)
      .select(
        'm.id',
        'm.thread_id',
        'm.sender_id',
        'm.content',
        'm.is_read',
        'm.created_at',
        'mt.subject as thread_subject',
        's.given_name as sender_given_name',
        's.family_name as sender_family_name',
      ) as Array<{
      id: string;
      thread_id: string | null;
      sender_id: string;
      content: string | null;
      is_read: boolean;
      created_at: Date | string;
      thread_subject: string | null;
      sender_given_name: string | null;
      sender_family_name: string | null;
    }>;

    const messages = rows.map((row) => {
      let parsedBody = '';
      let parsedSubject: string | null = row.thread_subject ?? null;
      let parsedUrgent = false;
      let authoredByPatient = false;
      try {
        const parsed = JSON.parse(row.content ?? '{}') as Record<string, unknown>;
        parsedBody = typeof parsed['body'] === 'string' ? parsed['body'] : '';
        if (typeof parsed['subject'] === 'string') parsedSubject = parsed['subject'];
        parsedUrgent = parsed['isUrgent'] === true;
        authoredByPatient = parsed['authoredByPatient'] === true;
      } catch {
        parsedBody = row.content ?? '';
      }

      const senderName = authoredByPatient
        ? patientDisplayName
        : (row.sender_given_name || row.sender_family_name
            ? `${row.sender_given_name ?? ''} ${row.sender_family_name ?? ''}`.trim()
            : (row.sender_id === req.user?.id ? patientDisplayName : 'Care Team'));

      return {
        id: row.id,
        threadId: row.thread_id,
        subject: parsedSubject,
        body: parsedBody,
        isRead: row.is_read,
        isUrgent: parsedUrgent,
        authoredByPatient,
        senderName,
        createdAt: toIsoString(row.created_at),
      };
    });

    res.json(MessagesResponseSchema.parse({ messages }));
  } catch (err) { next(err); }
});

router.post('/messages', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { body, subject, patientId } = PatientMessageCreateSchema.parse(req.body);
    const resolvedPatientId = patientId ?? req.user?.patientId ?? null;
    if (!resolvedPatientId) {
      throw new AppError('patientId is required', 400, 'VALIDATION_ERROR');
    }
    await requirePatientOwnership(req, resolvedPatientId);

    const clinicId = req.clinicId!;
    const isPatientActor = req.user?.isPatientApp === true;

    const resolveProxyStaffId = async (): Promise<string> => {
      const activeEpisode = await dbAdmin('episodes')
        .where({ clinic_id: clinicId, patient_id: resolvedPatientId, status: 'open' })
        .whereNull('deleted_at')
        .orderBy('start_date', 'desc')
        .first('primary_clinician_id');
      if (activeEpisode?.primary_clinician_id) return String(activeEpisode.primary_clinician_id);

      const fallbackStaff = await dbAdmin('staff')
        .where({ clinic_id: clinicId, is_active: true })
        .whereNull('deleted_at')
        .whereIn('role', ['clinician', 'manager', 'admin', 'superadmin'])
        .orderBy('created_at', 'asc')
        .first('id');
      if (fallbackStaff?.id) return String(fallbackStaff.id);

      throw new AppError('No staff actor available for patient-app message routing', 409, 'NO_STAFF_MESSAGE_ACTOR');
    };

    const senderId = isPatientActor ? await resolveProxyStaffId() : req.user!.id;

    let thread = await dbAdmin('message_threads')
      .where({ clinic_id: clinicId, patient_id: resolvedPatientId })
      .whereNull('deleted_at')
      .orderBy('updated_at', 'desc')
      .first('id');

    if (!thread?.id) {
      const episode = await dbAdmin('episodes')
        .where({ clinic_id: clinicId, patient_id: resolvedPatientId, status: 'open' })
        .whereNull('deleted_at')
        .orderBy('start_date', 'desc')
        .first('primary_clinician_id');
      const clinicianId = episode?.primary_clinician_id ?? null;
      const [createdThread] = await dbAdmin('message_threads')
        .insert({
          id: dbAdmin.raw('gen_random_uuid()'),
          clinic_id: clinicId,
          patient_id: resolvedPatientId,
          created_by_id: senderId,
          subject: subject?.trim() || 'Patient message',
          last_message_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning(['id']);
      thread = createdThread;

      const participantIds = new Set<string>([senderId]);
      if (clinicianId) participantIds.add(clinicianId);
      for (const participantId of participantIds) {
        const exists = await dbAdmin('message_thread_participants')
          .where({ thread_id: thread.id, user_id: participantId })
          .first('id');
        if (!exists) {
          await dbAdmin('message_thread_participants').insert({
            id: dbAdmin.raw('gen_random_uuid()'),
            thread_id: thread.id,
            user_id: participantId,
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
      }
    } else {
      const exists = await dbAdmin('message_thread_participants')
        .where({ thread_id: thread.id, user_id: senderId })
        .first('id');
      if (!exists) {
        await dbAdmin('message_thread_participants').insert({
          id: dbAdmin.raw('gen_random_uuid()'),
          thread_id: thread.id,
          user_id: senderId,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }

    const envelope = JSON.stringify({
      body,
      subject: subject?.trim() || null,
      patientId: resolvedPatientId,
      recipientId: null,
      isUrgent: false,
      authoredByPatient: isPatientActor,
      patientActorId: isPatientActor ? req.user!.id : null,
    });

    const [message] = await dbAdmin('messages')
      .insert({
        id: dbAdmin.raw('gen_random_uuid()'),
        clinic_id: clinicId,
        thread_id: thread.id,
        sender_id: senderId,
        content: envelope,
        is_read: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(['id', 'thread_id', 'created_at']);

    await dbAdmin('message_threads')
      .where({ id: thread.id, clinic_id: clinicId })
      .update({
        subject: subject?.trim() || dbAdmin.raw('subject'),
        last_message_at: new Date(),
        updated_at: new Date(),
      });

    res.status(201).json(PatientMessageCreatedResponseSchema.parse({
      id: message.id,
      threadId: message.thread_id,
      createdAt: toIsoString(message.created_at),
    }));
  } catch (err) { next(err); }
});

router.post('/messages/threads/:threadId/messages', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { body } = PatientMessageReplySchema.parse(req.body);
    const thread = await dbAdmin('message_threads')
      .where({ id: req.params.threadId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first('id', 'patient_id', 'subject', 'created_by_id');
    if (!thread) {
      throw new AppError('Message thread not found', 404, 'NOT_FOUND');
    }
    await requirePatientOwnership(req, String(thread.patient_id));
    const isPatientActor = req.user?.isPatientApp === true;
    const senderId = isPatientActor ? String(thread.created_by_id ?? '') : req.user!.id;
    if (!senderId) {
      throw new AppError('Message thread has no staff owner for patient reply routing', 409, 'THREAD_OWNER_MISSING');
    }

    const participantExists = await dbAdmin('message_thread_participants')
      .where({ thread_id: thread.id, user_id: senderId })
      .first('id');
    if (!participantExists) {
      await dbAdmin('message_thread_participants').insert({
        id: dbAdmin.raw('gen_random_uuid()'),
        thread_id: thread.id,
        user_id: senderId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    const [message] = await dbAdmin('messages')
      .insert({
        id: dbAdmin.raw('gen_random_uuid()'),
        clinic_id: req.clinicId,
        thread_id: thread.id,
        sender_id: senderId,
        content: JSON.stringify({
          body,
          subject: thread.subject ?? null,
          patientId: thread.patient_id,
          recipientId: null,
          isUrgent: false,
          authoredByPatient: isPatientActor,
          patientActorId: isPatientActor ? req.user!.id : null,
        }),
        is_read: false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning(['id', 'thread_id', 'created_at']);

    await dbAdmin('message_threads')
      .where({ id: thread.id, clinic_id: req.clinicId })
      .update({
        last_message_at: new Date(),
        updated_at: new Date(),
      });

    res.status(201).json(PatientMessageCreatedResponseSchema.parse({
      id: message.id,
      threadId: message.thread_id,
      createdAt: toIsoString(message.created_at),
    }));
  } catch (err) { next(err); }
});

router.patch('/messages/:messageId/read', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const row = await dbAdmin('messages as m')
      .join('message_threads as mt', function () {
        this.on('mt.id', 'm.thread_id').andOn('mt.clinic_id', 'm.clinic_id');
      })
      .where('m.id', req.params.messageId)
      .andWhere('m.clinic_id', req.clinicId)
      .first('m.id', 'mt.patient_id');
    if (!row?.id) {
      throw new AppError('Message not found', 404, 'NOT_FOUND');
    }

    await requirePatientOwnership(req, String(row.patient_id));

    await dbAdmin('messages')
      .where({ id: req.params.messageId, clinic_id: req.clinicId })
      .update({ is_read: true, updated_at: new Date() });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/appointments', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tokenPatientId = req.user?.patientId;
    const queryPatientId = typeof req.query.patientId === 'string' ? req.query.patientId : null;
    const patientId = queryPatientId ?? tokenPatientId ?? null;
    if (!patientId) {
      throw new AppError('patientId is required', 400, 'VALIDATION_ERROR');
    }
    await requirePatientOwnership(req, patientId);

    const includePast = String(req.query.includePast ?? 'false') === 'true';
    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.max(1, Math.min(200, Math.trunc(limitRaw)))
      : 20;

    const query = dbAdmin('appointments as a')
      .leftJoin('staff as s', function () {
        this.on('s.id', 'a.clinician_id').andOn('s.clinic_id', 'a.clinic_id');
      })
      .where('a.clinic_id', req.clinicId)
      .andWhere('a.patient_id', patientId)
      .whereNull('a.deleted_at')
      .orderBy('a.appointment_start', 'asc')
      .limit(limit)
      .select(
        'a.id',
        'a.appointment_start',
        'a.appointment_end',
        'a.start_time',
        'a.end_time',
        'a.appointment_type',
        'a.type',
        'a.status',
        'a.location',
        'a.notes',
        'a.patient_response',
        's.given_name as clinician_given_name',
        's.family_name as clinician_family_name',
      );

    if (!includePast) {
      query.andWhere('a.appointment_start', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000));
    }

    const rows = (await query) as Array<{
      id: string;
      appointment_start: Date | string | null;
      appointment_end: Date | string | null;
      start_time: Date | string | null;
      end_time: Date | string | null;
      appointment_type: string | null;
      type: string | null;
      status: string | null;
      location: string | null;
      notes: string | null;
      patient_response: 'attending' | 'not_attending' | null;
      clinician_given_name: string | null;
      clinician_family_name: string | null;
    }>;
    const appointments = rows.map((row) => {
      const startTime = toIsoString(row.appointment_start ?? row.start_time);
      const endTime = toIsoString(row.appointment_end ?? row.end_time);
      const clinicianName = [row.clinician_given_name, row.clinician_family_name]
        .filter((segment): segment is string => Boolean(segment && segment.trim()))
        .join(' ')
        .trim();
      return {
        id: row.id,
        startTime,
        endTime,
        appointmentType: row.appointment_type ?? row.type ?? null,
        status: row.status ?? 'scheduled',
        location: row.location,
        notes: row.notes,
        patientResponse: row.patient_response ?? null,
        clinicianName: clinicianName.length > 0 ? clinicianName : null,
      };
    });

    res.json(AppointmentsResponseSchema.parse({ appointments }));
  } catch (err) { next(err); }
});

router.get('/episodes/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin('episodes')
      .where({
        clinic_id: req.clinicId,
        patient_id: req.params.patientId,
      })
      .whereNull('deleted_at')
      .orderBy('start_date', 'desc')
      .select(
        'id',
        'clinic_id',
        'patient_id',
        'status',
        'episode_type',
        'presenting_problem',
        'start_date',
        'end_date',
        'team_id',
        'primary_clinician_id',
        'created_at',
        'updated_at',
      );
    res.json(EpisodesResponseSchema.parse({
      data: rows.map((row) => ({
        id: row.id,
        clinicId: row.clinic_id,
        patientId: row.patient_id,
        status: row.status,
        episodeType: row.episode_type,
        presentingProblem: row.presenting_problem,
        startDate: toIsoString(row.start_date),
        endDate: toIsoString(row.end_date),
        teamId: row.team_id,
        primaryClinicianId: row.primary_clinician_id,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
      })),
    }));
  } catch (err) { next(err); }
});

router.get('/episodes/:episodeId/allocation', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const episode = await dbAdmin('episodes')
      .where({
        id: req.params.episodeId,
        clinic_id: req.clinicId,
      })
      .whereNull('deleted_at')
      .first(
        'id',
        'patient_id',
        'team_id',
        'primary_clinician_id',
      ) as {
      id: string;
      patient_id: string;
      team_id: string | null;
      primary_clinician_id: string | null;
    } | undefined;

    if (!episode) {
      throw new AppError('Episode not found', 404, 'NOT_FOUND');
    }

    await requirePatientOwnership(req, episode.patient_id);

    const orgUnitId = episode.team_id ?? null;
    const mdtRows = orgUnitId
      ? await dbAdmin('staff_role_assignments as sra')
          .join('clinical_roles as cr', 'cr.id', 'sra.clinical_role_id')
          .join('staff as s', 's.id', 'sra.staff_id')
          .where('sra.clinic_id', req.clinicId)
          .andWhere('sra.org_unit_id', orgUnitId)
          .andWhere('sra.is_active', true)
          .where((qb) =>
            qb
              .whereNull('sra.end_date')
              .orWhere('sra.end_date', '>=', new Date().toISOString().slice(0, 10)),
          )
          .orderBy('sra.updated_at', 'desc')
          .select(
            'sra.staff_id',
            'cr.name as role_name',
            dbAdmin.raw("s.given_name || ' ' || s.family_name as staff_name"),
          )
      : [];

    const teamNameRow = orgUnitId
      ? await dbAdmin('org_units')
          .where({ id: orgUnitId, clinic_id: req.clinicId })
          .first('name')
      : null;

    const seen = new Set<string>();
    const mdt = mdtRows
      .filter((row) => {
        const key = `${row.staff_id}:${String(row.role_name ?? '').toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((row) => ({
        staffId: row.staff_id,
        staffName: row.staff_name,
        roleName: row.role_name,
      }));

    res.json(EpisodeAllocationResponseSchema.parse({
      episodeId: episode.id,
      orgUnitId,
      teamName: teamNameRow?.name ?? null,
      primaryClinicianId: episode.primary_clinician_id,
      mdt,
    }));
  } catch (err) { next(err); }
});


router.post('/tracking', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    const patientId = user?.patientId ?? req.body.patientId;
    const clinicId = user?.clinicId ?? req.clinicId;

    if (!patientId || !clinicId) {
      throw new AppError('Missing patient context', 400, 'PATIENT_CONTEXT_MISSING');
    }

    const { entries } = TrackingBatchSchema.parse(req.body);
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new AppError('entries array is required', 400, 'VALIDATION_ERROR');
    }

    const trackingEntries: TrackingBatchEntry[] = entries;
    const rows = trackingEntries.map((e) => ({
      clinic_id: clinicId,
      patient_id: patientId,
      tracking_type: e.trackingType ?? e.type,
      value: e.value,
      note: e.note ?? null,
      recorded_at: e.timestamp ? new Date(e.timestamp) : new Date(),
      source: user?.isPatientApp ? 'patient_app' : 'clinician',
    }));

    await dbAdmin('patient_tracking').insert(rows);

    res.status(201).json({ ok: true, count: rows.length });
  } catch (err) { next(err); }
});

router.get('/tracking/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const patientId = req.params.patientId;
    const type = req.query.type as string | undefined;
    const days = parseInt(req.query.days as string ?? '30', 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let q = dbAdmin<TrackingQueryRow>('patient_tracking')
      .where({ patient_id: patientId, clinic_id: req.clinicId })
      .where('recorded_at', '>=', since)
      .orderBy('recorded_at', 'desc')
      .limit(500);

    if (type) q = q.where({ tracking_type: type });

    const rows = await q;

    res.json(TrackingEntriesResponseSchema.parse({
      entries: rows.map((r) => ({
        id: r.id,
        type: r.tracking_type,
        value: Number(r.value),
        note: r.note,
        source: r.source,
        recordedAt: r.recorded_at,
      })),
    }));
  } catch (err) { next(err); }
});


router.patch('/tracking/:entryId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // BUG-490 — entry-id-keyed IDOR closure
    const { value, note } = SingleTrackingSchema.parse(req.body);
    const patch: Record<string, unknown> = {};
    if (value !== undefined) patch.value = Number(value);
    if (note !== undefined) patch.note = note;
    if (Object.keys(patch).length === 0) throw new AppError('Nothing to update', 400, 'VALIDATION_ERROR');
    const entry = await dbAdmin('patient_tracking')
      .where({ id: req.params.entryId })
      .select('patient_id', 'clinic_id')
      .first() as { patient_id: string; clinic_id: string } | undefined;
    if (!entry) throw new AppError('Tracking entry not found', 404, 'NOT_FOUND');
    await requirePatientOwnership(req, entry.patient_id);
    await dbAdmin('patient_tracking')
      .where({ id: req.params.entryId, clinic_id: req.clinicId })
      .update(patch);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/tracking/:entryId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = await dbAdmin('patient_tracking')
      .where({ id: req.params.entryId })
      .select('patient_id', 'clinic_id')
      .first() as { patient_id: string; clinic_id: string } | undefined;
    if (!entry) throw new AppError('Tracking entry not found', 404, 'NOT_FOUND');
    await requirePatientOwnership(req, entry.patient_id);
    await dbAdmin('patient_tracking')
      .where({ id: req.params.entryId, clinic_id: req.clinicId })
      .delete();
    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.get('/med-reminders/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin<MedReminderQueryRow>('patient_med_reminders')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId, is_active: true })
      .orderBy('reminder_time');
    res.json(MedRemindersResponseSchema.parse({ reminders: rows.map(mapMedReminderRowToResponse) }));
  } catch (err) { next(err); }
});

router.post('/med-reminders/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { drugName, dose, instructions, daysOfWeek, reminderTime, medicationId } = MedReminderSchema.parse(req.body);
    if (!drugName || !instructions) throw new AppError('drugName and instructions required', 400, 'VALIDATION_ERROR');
    const [row] = await dbAdmin('patient_med_reminders').insert({
      clinic_id: req.clinicId, patient_id: req.params.patientId,
      medication_id: medicationId ?? null, drug_name: drugName, dose: dose ?? null,
      instructions, days_of_week: daysOfWeek ?? [1,2,3,4,5,6,7],
      reminder_time: reminderTime ?? '08:00', created_by: req.user!.id,
    }).returning(PATIENT_MED_REMINDERS_COLUMNS);
    res.status(201).json({ reminder: { id: row.id, drugName: row.drug_name, instructions: row.instructions } });
  } catch (err) { next(err); }
});

router.delete('/med-reminders/:patientId/:reminderId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await dbAdmin('patient_med_reminders').where({ id: req.params.reminderId, patient_id: req.params.patientId, clinic_id: req.clinicId }).update({ is_active: false });
    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.get('/shared-docs/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin<SharedDocumentQueryRow>('patient_shared_documents')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .orderBy('created_at', 'desc');
    res.json(SharedDocumentsResponseSchema.parse({ documents: rows.map(mapSharedDocumentRowToResponse) }));
  } catch (err) { next(err); }
});

router.post('/shared-docs/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { title, docType, url, filePath } = DocumentUploadSchema.parse(req.body);
    if (!title) throw new AppError('title required', 400, 'VALIDATION_ERROR');
    const [row] = await dbAdmin('patient_shared_documents').insert({
      clinic_id: req.clinicId, patient_id: req.params.patientId,
      title, doc_type: docType ?? (url ? 'weblink' : 'document'),
      file_path: filePath ?? null, url: url ?? null, shared_by: req.user!.id,
    }).returning(PATIENT_SHARED_DOCUMENTS_COLUMNS);
    res.status(201).json({ document: { id: row.id, title: row.title, docType: row.doc_type } });
  } catch (err) { next(err); }
});


router.get('/triage/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const row = await dbAdmin('patients').where({ id: req.params.patientId, clinic_id: req.clinicId }).select('viva_triage_number').first();
    res.json({ triageNumber: row?.viva_triage_number ?? null });
  } catch (err) { next(err); }
});

router.put('/triage/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { triageNumber } = TriageNumberSchema.parse(req.body);
    await dbAdmin('patients').where({ id: req.params.patientId, clinic_id: req.clinicId })
      .update({ viva_triage_number: triageNumber ?? null });
    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.patch('/appointment-response/:appointmentId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { response } = TriageResponseSchema.parse(req.body);
    if (!['attending', 'not_attending'].includes(response)) {
      throw new AppError('response must be attending or not_attending', 400, 'VALIDATION_ERROR');
    }
    const appt = await dbAdmin('appointments')
      .where({ id: req.params.appointmentId })
      .select('patient_id', 'clinic_id')
      .first() as { patient_id: string; clinic_id: string } | undefined;
    if (!appt) throw new AppError('Appointment not found', 404, 'NOT_FOUND');
    await requirePatientOwnership(req, appt.patient_id);
    await dbAdmin('appointments')
      .where({ id: req.params.appointmentId, clinic_id: req.clinicId })
      .update({ patient_response: response });
    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.get('/thresholds/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin('viva_alert_thresholds')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId, is_active: true })
      .orderBy('tracking_type');
    res.json({ thresholds: rows });
  } catch (err) { next(err); }
});

router.post('/thresholds/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { trackingType, direction, threshold, consecutiveDays } = AlertThresholdSchema.parse(req.body);
    if (!trackingType || threshold == null) {
      throw new AppError('trackingType and threshold required', 400, 'VALIDATION_ERROR');
    }
    const [row] = await dbAdmin('viva_alert_thresholds').insert({
      clinic_id: req.clinicId,
      patient_id: req.params.patientId,
      tracking_type: trackingType,
      direction: direction ?? 'below',
      threshold: Number(threshold),
      consecutive_days: consecutiveDays ?? 3,
      created_by: req.user!.id,
    }).returning(VIVA_ALERT_THRESHOLDS_COLUMNS);
    res.status(201).json({ threshold: row });
  } catch (err) { next(err); }
});

router.delete('/thresholds/:patientId/:thresholdId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await dbAdmin('viva_alert_thresholds')
      .where({ id: req.params.thresholdId, patient_id: req.params.patientId, clinic_id: req.clinicId })
      .update({ is_active: false, updated_at: new Date() });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/threshold-check/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const patientId = req.params.patientId;
    const thresholds = await dbAdmin('viva_alert_thresholds')
      .where({ patient_id: patientId, clinic_id: req.clinicId, is_active: true });

    const alerts: Array<{ type: string; threshold: number; direction: string; consecutiveDays: number; actual: number[]; triggered: boolean }> = [];

    for (const t of thresholds) {
      const days = t.consecutive_days ?? 3;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const rows = await dbAdmin('patient_tracking')
        .where({ patient_id: patientId, clinic_id: req.clinicId, tracking_type: t.tracking_type })
        .where('recorded_at', '>=', since)
        .orderBy('recorded_at', 'desc')
        .limit(days * 3); // allow multiple entries per day

      const byDate: Record<string, number> = {};
      for (const r of rows) {
        const dateKey = new Date(r.recorded_at).toISOString().split('T')[0];
        if (!byDate[dateKey]) byDate[dateKey] = Number(r.value);
      }
      const recentValues = Object.values(byDate).slice(0, days);

      const triggered = recentValues.length >= days && recentValues.every(v =>
        t.direction === 'below' ? v <= Number(t.threshold) : v >= Number(t.threshold)
      );

      alerts.push({
        type: t.tracking_type,
        threshold: Number(t.threshold),
        direction: t.direction,
        consecutiveDays: t.consecutive_days,
        actual: recentValues,
        triggered,
      });
    }

    res.json({ alerts });
  } catch (err) { next(err); }
});


router.get('/self-rating-templates', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Phase 8 — operator brief: "Self-rated scales must move to the Viva
    // assessment tab." This endpoint returns ONLY templates classified
    // by the canonical SCALE_REGISTRY as `rating_scale` + `self_rated`.
    //
    // Historical bug: this filter used `category: 'Self-Rating'`, but
    // the seed scripts use `category: 'Rating Scales'` for every scale
    // — so the endpoint returned an empty list and the Viva self-rating
    // flow was broken. The registry-based filter resolves the breakage
    // structurally (no more free-text category mismatches).
    const { matched, unknownCount } = await listClinicSelfRatingDefinitions(req.clinicId);
    if (unknownCount > 0) {
      logger.warn(
        { unknownCount, clinicId: req.clinicId },
        '[patient-app/self-rating-templates] templates with no registry classification skipped',
      );
    }
    // Preserve the historical response shape (templates: row[]) so the
    // existing Viva client renders unchanged; add the canonical slug so
    // future clients can join on it without re-parsing the name.
    res.json(SelfRatingTemplatesResponseSchema.parse({
      templates: matched.map((m) => ({
        id: m.id,
        templateId: m.templateId,
        slug: m.slug,
        name: m.name,
        description: m.description,
        category: 'Rating Scales',
        type: 'assessment',
        content: m.content,
      })),
    }));
  } catch (err) { next(err); }
});

router.post('/assessments/:patientId/assign', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { templateId } = AssessmentStartSchema.parse(req.body);
    if (!templateId) throw new AppError('templateId required', 400, 'VALIDATION_ERROR');

    const template = await findClinicSelfRatingDefinition(req.clinicId, templateId);
    if (!template) throw new AppError('Template not found', 404, 'NOT_FOUND');
    const classified = classifyTemplate({
      id: template.id,
      name: template.name,
      category: 'Rating Scales',
      description: template.description,
      content: template.content,
    });
    if (classified.family !== 'rating_scale' || classified.raterType !== 'self_rated') {
      throw new AppError(
        'Only self-rated rating-scale templates can be assigned to Viva assessments',
        400,
        'INVALID_SELF_RATING_TEMPLATE',
      );
    }

    const [row] = await dbAdmin('outcome_measures').insert({
      clinic_id: req.clinicId,
      patient_id: req.params.patientId,
      staff_id: req.user!.id,
      measure_type: template.name,
      template_id: template.templateId,
      template_name: template.name,
      assigned_by: req.user!.id,
      assigned_for_patient: true,
      status: 'pending',
      items: template.content, // questions from template
      total_score: null,
      collection_occasion: 'Viva App',
    }).returning(OUTCOME_MEASURES_COLUMNS);

    logger.info({ patientId: req.params.patientId, templateName: template.name }, 'Self-rating scale assigned to patient');
    res.status(201).json(PatientAssignedAssessmentResponseSchema.parse({ assessment: row }));
  } catch (err) { next(err); }
});

router.get('/assessments/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin('outcome_measures')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId, assigned_for_patient: true })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
    res.json({ assessments: rows });
  } catch (err) { next(err); }
});

router.patch('/assessments/:patientId/:assessmentId/complete', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { totalScore, responses } = AssessmentSubmitSchema.parse(req.body);

    const existing = await dbAdmin('outcome_measures')
      .where({ id: req.params.assessmentId, patient_id: req.params.patientId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .first(
        'id',
        'clinic_id',
        'patient_id',
        'episode_id',
        'staff_id',
        'measure_type',
        'template_name',
      );

    if (!existing?.id) throw new AppError('Assessment not found', 404, 'ASSESSMENT_NOT_FOUND');

    const riskSignal = detectSuicideRiskSignal({
      measureType: String(existing.measure_type ?? ''),
      templateName: String(existing.template_name ?? ''),
      responses,
      submittedTotalScore: totalScore ?? null,
    });

    if (riskSignal.hasScoreMismatch) {
      logger.warn(
        {
          clinicId: req.clinicId,
          patientId: req.params.patientId,
          assessmentId: req.params.assessmentId,
          submittedTotalScore: riskSignal.submittedTotalScore,
          derivedTotalScore: riskSignal.totalScore,
        },
        'Assessment completion submitted total score mismatch; using server-derived score',
      );
    }

    if (riskSignal.totalScore == null || Number.isNaN(riskSignal.totalScore)) {
      throw new AppError(
        'Unable to derive total score from assessment responses',
        422,
        'ASSESSMENT_SCORE_DERIVATION_FAILED',
      );
    }

    await dbAdmin('outcome_measures')
      .where({ id: req.params.assessmentId, patient_id: req.params.patientId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .update({
        total_score: Number(riskSignal.totalScore),
        items: responses ? JSON.stringify(responses) : undefined,
        status: 'completed',
        completed_at: new Date(),
        notes: `Completed by patient via Viva app. Score: ${riskSignal.totalScore}`,
        lock_version: dbAdmin.raw('lock_version + 1'),
        updated_at: new Date(),
      });

    if (riskSignal.triggered) {
      let targetStaffId = existing.staff_id ? String(existing.staff_id) : null;
      if (!targetStaffId) {
        const activeEpisode = await dbAdmin('episodes')
          .where({ clinic_id: req.clinicId, patient_id: req.params.patientId, status: 'open' })
          .whereNull('deleted_at')
          .orderBy('start_date', 'desc')
          .first('primary_clinician_id');
        targetStaffId = activeEpisode?.primary_clinician_id
          ? String(activeEpisode.primary_clinician_id)
          : null;
      }

      if (targetStaffId) {
        try {
          await createTaskInternal(req.clinicId, targetStaffId, {
            assignedToId: targetStaffId,
            patientId: req.params.patientId,
            episodeId: existing.episode_id ? String(existing.episode_id) : undefined,
            priority: 'urgent',
            title: 'Immediate suicide-risk assessment review required',
            description:
              `Patient-submitted PHQ-9 trigger: ${riskSignal.reason ?? 'risk threshold met'}. ` +
              `Total score: ${riskSignal.totalScore ?? 'n/a'}, Q9: ${riskSignal.q9Score ?? 'n/a'}.`,
            dueDate: new Date().toISOString(),
          });

          await emitClinicalSignal({
            clinicId: req.clinicId,
            userId: targetStaffId,
            source: 'system',
            signalKey: 'patient_app_phq9_suicide_risk',
            severity: 'critical',
            category: 'risk',
            title: 'Patient app PHQ-9 high-risk trigger',
            body:
              `Immediate review required. ${riskSignal.reason ?? 'PHQ-9 threshold met'}. ` +
              `Total ${riskSignal.totalScore ?? 'n/a'}, Q9 ${riskSignal.q9Score ?? 'n/a'}.`,
            actionUrl: `/patients/${req.params.patientId}`,
            dedupeKey: `patient-app-phq9-risk:${req.params.assessmentId}:${Date.now()}`,
            payload: {
              patient_id: req.params.patientId,
              assessment_id: req.params.assessmentId,
              total_score: riskSignal.totalScore,
              q9_score: riskSignal.q9Score,
              reason: riskSignal.reason,
            },
          });
        } catch (err) {
          logger.warn(
            {
              err,
              clinicId: req.clinicId,
              patientId: req.params.patientId,
              assessmentId: req.params.assessmentId,
            },
            'patient-app assessment suicide-risk escalation failed; continuing completion flow',
          );
        }
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.get('/tasks/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await dbAdmin('patient_tasks')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .whereNot({ status: 'cancelled' })
      .orderBy('due_date', 'asc');
    res.json({ tasks: rows });
  } catch (err) { next(err); }
});

router.post('/tasks/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { title, description, dueDate, reminderTime } = TaskCreateSchema.parse(req.body);
    if (!title) throw new AppError('title required', 400, 'VALIDATION_ERROR');
    const isPatient = req.user?.isPatientApp === true;
    const clinicId = req.clinicId;
    if (!clinicId) throw new AppError('Missing clinic context', 400, 'CLINIC_CONTEXT_MISSING');
    const [row] = await dbAdmin('patient_tasks').insert({
      clinic_id: clinicId, patient_id: req.params.patientId,
      title, description: description ?? null,
      due_date: dueDate ?? null, reminder_time: reminderTime ?? null,
      created_by: isPatient ? null : req.user!.id,
    }).returning(PATIENT_TASKS_COLUMNS);
    res.status(201).json({ task: row });
  } catch (err) { next(err); }
});

router.patch('/tasks/:patientId/:taskId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { status } = TaskStatusSchema.parse(req.body);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (status) patch.status = status;
    if (status === 'completed') patch.completed_at = new Date();
    await dbAdmin('patient_tasks').where({ id: req.params.taskId, patient_id: req.params.patientId, clinic_id: req.clinicId }).update(patch);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/interventions/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await assertPathwaysModuleEnabled(req.clinicId!);
    const pathwayRef = await resolvePathwayForPatient(
      req.clinicId!,
      req.params.patientId,
      typeof req.query.pathwayId === 'string' ? req.query.pathwayId : undefined,
    );
    const auth = toPathwayAuthContext(req);
    const bundle = await pathwayService.getDigitalInterventions(auth, pathwayRef.id);
    const pathway = await pathwayRepository.findById(req.clinicId!, pathwayRef.id);
    res.json(PathwayPatientInterventionsResponseSchema.parse({
      pathwayId: bundle.pathwayId,
      pathwayName: pathway?.name ?? 'Treatment Pathway',
      lockVersion: bundle.lockVersion,
      packs: bundle.packs,
      thoughtDiaryEntries: bundle.thoughtDiaryEntries,
      sleepJourneyCheckIns: bundle.sleepJourneyCheckIns,
    }));
  } catch (err) { next(err); }
});

router.post('/interventions/:patientId/packs/:packId/items/:itemId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await assertPathwaysModuleEnabled(req.clinicId!);
    const parsed = PatientInterventionItemCompletionSchema.parse(req.body);
    const pathwayRef = await resolvePathwayForPatient(
      req.clinicId!,
      req.params.patientId,
      typeof req.body.pathwayId === 'string' ? req.body.pathwayId : undefined,
    );
    const auth = toPathwayAuthContext(req);
    const bundle = await pathwayService.setInterventionItemCompletion(
      auth,
      pathwayRef.id,
      req.params.packId,
      req.params.itemId,
      parsed,
    );
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.post('/interventions/:patientId/thought-diary', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await assertPathwaysModuleEnabled(req.clinicId!);
    const parsed = PatientThoughtDiarySubmissionSchema.parse(req.body);
    const pathwayRef = await resolvePathwayForPatient(
      req.clinicId!,
      req.params.patientId,
      typeof req.body.pathwayId === 'string' ? req.body.pathwayId : undefined,
    );
    const auth = toPathwayAuthContext(req);
    const bundle = await pathwayService.addThoughtDiaryEntry(auth, pathwayRef.id, parsed);
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.post('/interventions/:patientId/sleep-hygiene/check-in', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await assertPathwaysModuleEnabled(req.clinicId!);
    const parsed = PatientSleepCheckInSubmissionSchema.parse(req.body);
    const pathwayRef = await resolvePathwayForPatient(
      req.clinicId!,
      req.params.patientId,
      typeof req.body.pathwayId === 'string' ? req.body.pathwayId : undefined,
    );
    const auth = toPathwayAuthContext(req);
    const bundle = await pathwayService.addSleepHygieneCheckIn(auth, pathwayRef.id, parsed);
    res.json(PathwayDigitalInterventionBundleSchema.parse(bundle));
  } catch (err) { next(err); }
});

router.get('/interventions/:patientId/micro-learning', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    await assertPathwaysModuleEnabled(req.clinicId!);
    const [assignments, cards] = await Promise.all([
      behavioralEngagementService.listPatientMicroLearningAssignments(toPathwayAuthContext(req), req.params.patientId),
      behavioralEngagementService.listMicroLearningCards(toPathwayAuthContext(req)),
    ]);
    res.json(PatientMicroLearningResponseSchema.parse({ assignments, cards }));
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

router.get('/wearables/:patientId/sources', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await digitalPhenotypingService.listDeviceSources(
      toPathwayAuthContext(req),
      req.params.patientId,
    );
    res.json(WearableDeviceSourceListResponseSchema.parse({ sources: rows }));
  } catch (err) { next(err); }
});

router.post('/wearables/:patientId/sources', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const parsed = PatientWearableSourceCreateSchema.parse(req.body);
    const created = await digitalPhenotypingService.createDeviceSource(
      toPathwayAuthContext(req),
      req.params.patientId,
      parsed,
    );
    res.status(201).json(WearableDeviceSourceCreateResponseSchema.parse({ source: created }));
  } catch (err) { next(err); }
});

router.post('/wearables/:patientId/ingest', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const parsed = PatientWearableIngestSchema.parse(req.body);
    const outcome = await digitalPhenotypingService.ingestWearableBatch(
      toPathwayAuthContext(req),
      req.params.patientId,
      parsed,
    );
    res.status(201).json(WearableIngestOutcomeSchema.parse(outcome));
  } catch (err) { next(err); }
});

router.get('/wearables/:patientId/phenotypes', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const rows = await digitalPhenotypingService.listRecentPhenotypes(
      toPathwayAuthContext(req),
      req.params.patientId,
      Number(req.query.limit ?? 30),
    );
    res.json(DigitalPhenotypeRowsResponseSchema.parse({ rows }));
  } catch (err) { next(err); }
});

router.get('/wearables/:patientId/surveillance', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const snapshot = await digitalPhenotypingService.getWearableSurveillanceSnapshot(
      toPathwayAuthContext(req),
      req.params.patientId,
    );
    res.json(WearableSurveillanceSnapshotSchema.parse(snapshot));
  } catch (err) { next(err); }
});


router.get('/checklists/:patientId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const appointmentId = req.query.appointmentId as string | undefined;
    let q = dbAdmin('appointment_checklists').where({ patient_id: req.params.patientId, clinic_id: req.clinicId }).orderBy('sort_order');
    if (appointmentId) q = q.where({ appointment_id: appointmentId });
    const rows = await q;
    res.json({ checklists: rows });
  } catch (err) { next(err); }
});

router.post('/checklists/:patientId', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { item, appointmentId, sortOrder } = ChecklistItemCreateSchema.parse(req.body);
    if (!item) throw new AppError('item required', 400, 'VALIDATION_ERROR');
    const [row] = await dbAdmin('appointment_checklists').insert({
      clinic_id: req.clinicId, patient_id: req.params.patientId,
      appointment_id: appointmentId ?? null, item,
      sort_order: sortOrder ?? 0, created_by: req.user!.id,
    }).returning(APPOINTMENT_CHECKLISTS_COLUMNS);
    res.status(201).json({ checklist: row });
  } catch (err) { next(err); }
});

router.patch('/checklists/:patientId/:checklistId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requirePatientOwnership(req, req.params.patientId);
    const { isCompleted } = ChecklistItemToggleSchema.parse(req.body);
    await dbAdmin('appointment_checklists')
      .where({ id: req.params.checklistId, patient_id: req.params.patientId, clinic_id: req.clinicId })
      .update({ is_completed: isCompleted ?? false });
    res.json({ ok: true });
  } catch (err) { next(err); }
});


router.post('/fcm/register-device', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { id: string; patientId?: string; clinicId?: string };
    const patientId = user.patientId ?? null;
    if (!patientId) throw new AppError('Patient context missing from token', 400, 'PATIENT_CONTEXT_MISSING');

    const { deviceToken, platform } = RegisterDeviceSchema.parse(req.body);
    if (!deviceToken || deviceToken.length < 10) {
      throw new AppError('deviceToken is required and must be at least 10 characters', 400, 'VALIDATION_ERROR');
    }
    if (platform !== 'ios' && platform !== 'android') {
      throw new AppError("platform must be 'ios' or 'android'", 400, 'VALIDATION_ERROR');
    }

    const patient = await dbAdmin('patients')
      .where({ id: patientId })
      .whereNull('deleted_at')
      .select('clinic_id')
      .first() as { clinic_id: string } | undefined;
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');

    const existing = await dbAdmin('patient_fcm_tokens')
      .where({ patient_id: patientId, clinic_id: patient.clinic_id, device_token: deviceToken })
      .first() as { id: string } | undefined;

    if (existing) {
      await dbAdmin('patient_fcm_tokens')
        .where({ id: existing.id, clinic_id: patient.clinic_id })
        .update({ deleted_at: null, last_seen_at: new Date(), platform });
      res.json({ id: existing.id, resurrected: true });
      return;
    }

    const account = await dbAdmin('patient_app_accounts')
      .where({ patient_id: patientId })
      .select('id')
      .first() as { id: string } | undefined;

    const [row] = await dbAdmin('patient_fcm_tokens')
      .insert({
        clinic_id: patient.clinic_id,
        patient_id: patientId,
        patient_app_account_id: account?.id ?? null,
        device_token: deviceToken,
        platform,
        last_seen_at: new Date(),
        created_at: new Date(),
      })
      .returning('id') as { id: string }[];
    res.status(201).json({ id: row.id, resurrected: false });
  } catch (err) { next(err); }
});

router.delete('/fcm/register-device/:token', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { id: string; patientId?: string };
    const patientId = user.patientId ?? null;
    if (!patientId) throw new AppError('Patient context missing from token', 400, 'PATIENT_CONTEXT_MISSING');
    const patient = await dbAdmin('patients').where({ id: patientId }).select('clinic_id').first() as { clinic_id: string } | undefined;
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');
    const deleted = await dbAdmin('patient_fcm_tokens')
      .where({ patient_id: patientId, clinic_id: patient.clinic_id, device_token: req.params.token })
      .whereNull('deleted_at')
      .update({ deleted_at: new Date() });
    res.json({ deleted });
  } catch (err) { next(err); }
});


const SYNC_MODULE_KEYS = ['appointments', 'messages', 'documents', 'notifications', 'reminders'] as const;
type SyncModuleKey = typeof SYNC_MODULE_KEYS[number];

router.get('/sync-preferences', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { id: string; patientId?: string };
    const patientId = user.patientId ?? null;
    if (!patientId) throw new AppError('Patient context missing from token', 400, 'PATIENT_CONTEXT_MISSING');

    const patient = await dbAdmin('patients').where({ id: patientId }).select('clinic_id').first() as { clinic_id: string } | undefined;
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');

    const rows = await dbAdmin('patient_sync_preferences')
      .where({ patient_id: patientId, clinic_id: patient.clinic_id })
      .select('module_key', 'enabled', 'updated_by_patient', 'updated_at') as Array<{
        module_key: string;
        enabled: boolean;
        updated_by_patient: boolean;
        updated_at: Date;
      }>;

    const byKey = new Map(rows.map((r) => [r.module_key, r]));
    const items = SYNC_MODULE_KEYS.map((key) => {
      const row = byKey.get(key);
      return {
        moduleKey: key,
        enabled: row?.enabled ?? false,
        updatedByPatient: row?.updated_by_patient ?? false,
        updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    });

    res.json({ items });
  } catch (err) { next(err); }
});

router.patch('/sync-preferences', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { id: string; patientId?: string };
    const patientId = user.patientId ?? null;
    if (!patientId) throw new AppError('Patient context missing from token', 400, 'PATIENT_CONTEXT_MISSING');

    const { moduleKey, enabled } = SyncPreferenceSchema.parse(req.body);
    if (!moduleKey || !(SYNC_MODULE_KEYS as readonly string[]).includes(moduleKey)) {
      throw new AppError(`moduleKey must be one of ${SYNC_MODULE_KEYS.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    if (typeof enabled !== 'boolean') {
      throw new AppError('enabled must be boolean', 400, 'VALIDATION_ERROR');
    }

    const patient = await dbAdmin('patients').where({ id: patientId }).select('clinic_id').first() as { clinic_id: string } | undefined;
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');

    const existing = await dbAdmin('patient_sync_preferences')
      .where({ patient_id: patientId, clinic_id: patient.clinic_id, module_key: moduleKey })
      .first() as { id: string } | undefined;

    if (existing) {
      await dbAdmin('patient_sync_preferences')
        .where({ id: existing.id, clinic_id: patient.clinic_id })
        .update({
          enabled,
          updated_by_patient: true,
          updated_at: new Date(),
        });
    } else {
      await dbAdmin('patient_sync_preferences').insert({
        clinic_id: patient.clinic_id,
        patient_id: patientId,
        module_key: moduleKey as SyncModuleKey,
        enabled,
        updated_by_patient: true,
        updated_at: new Date(),
        created_at: new Date(),
      });
    }

    try {
      const auditLogService = (await import('../../utils/audit')).default;
      await auditLogService.logUpdate({
        clinicId: patient.clinic_id,
        userId: user.id,
        tableName: 'patient_sync_preferences',
        recordId: `${patientId}:${moduleKey}`,
        oldData: {},
        newData: { module_key: moduleKey, enabled, updated_by_patient: true },
      });
    } catch (err) {
      logger.warn(
        {
          err,
          kind: 'audit_write_failure',
          action: 'patient_sync_preferences_update',
          clinicId: patient.clinic_id,
          patientId,
          actorPatientUserId: user.id,
          moduleKey,
          enabled,
        },
        'BUG-517: audit write failed for patient_sync_preferences update; mutation succeeded but audit row missing',
      );
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/mobile-sync', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { id: string; patientId?: string };
    const patientId = user.patientId ?? null;
    if (!patientId) throw new AppError('Patient context missing from token', 400, 'PATIENT_CONTEXT_MISSING');

    const patient = await dbAdmin('patients').where({ id: patientId }).select('clinic_id').first() as { clinic_id: string } | undefined;
    if (!patient) throw new AppError('Patient not found', 404, 'NOT_FOUND');

    const rawSince = typeof req.query.since === 'string' ? req.query.since : null;
    const cursor = rawSince ? new Date(rawSince) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const prefRows = await dbAdmin('patient_sync_preferences')
      .where({ patient_id: patientId, clinic_id: patient.clinic_id })
      .select('module_key', 'enabled') as Array<{ module_key: string; enabled: boolean }>;
    const enabled = new Map(prefRows.map((r) => [r.module_key, r.enabled]));

    const notifications = enabled.get('notifications') === true
      ? await dbAdmin('notifications')
          .where({ clinic_id: patient.clinic_id })
          .whereNull('recipient_staff_id')
          .andWhere((b) => {
            b.where('created_at', '>', cursor)
              .orWhere('read_at', '>', cursor);
          })
          .orderBy('created_at', 'desc')
          .limit(500)
          .select(
            'id',
            'clinic_id',
            'severity',
            'category',
            'title',
            'body',
            'link as action_url',
            'payload',
            'read_at',
            'expires_at',
            'created_at',
          )
      : [];

    const appointments = enabled.get('appointments') === true
      ? await dbAdmin('appointments')
          .where({ patient_id: patientId })
          .where('updated_at', '>', cursor)
          .orderBy('start_time', 'asc')
          .limit(500)
          .select(
            'id',
            'clinic_id',
            'patient_id',
            'start_time',
            'end_time',
            'appointment_type',
            'status',
            'staff_id',
            'location',
            'notes',
            'deleted_at',
            'updated_at',
          )
          .catch((err) => { logger.warn({ err, patientId, clinicId: patient.clinic_id }, 'Patient app sync: appointments query failed — degraded to []'); return []; })
      : [];

    const outreachLog = enabled.get('reminders') === true
      ? await dbAdmin('patient_outreach_log')
          .where({ clinic_id: patient.clinic_id, patient_id: patientId })
          .where('attempted_at', '>', cursor)
          .orderBy('attempted_at', 'desc')
          .limit(200)
          .select(
            'id',
            'kind',
            'channel',
            'title',
            'body',
            'deep_link as action_url',
            'attempted_at',
            'delivered_at',
          )
          .catch((err) => { logger.warn({ err, patientId, clinicId: patient.clinic_id }, 'Patient app sync: outreach_log query failed — degraded to []'); return []; })
      : [];

    let documents: Array<Record<string, unknown>> = [];
    if (enabled.get('documents') === true) {
      const rows = await dbAdmin('patient_attachments')
        .where({ patient_id: patientId, clinic_id: patient.clinic_id, is_active: true })
        .where('created_at', '>', cursor)
        .orderBy('created_at', 'desc')
        .limit(200) as Array<Record<string, unknown>>;
      documents = await Promise.all(
        rows.map(async (r) => ({
          id: r.id,
          patient_id: r.patient_id,
          filename: r.filename,
          label: r.label,
          mime_type: r.mime_type,
          file_size: r.file_size,
          created_at: r.created_at,
          server_updated_at: r.created_at,
          download_url: await resolveAttachmentDownloadUrl(r as never),
        })),
      );
    }

    res.json(MobileSyncResponseSchema.parse({
      notifications,
      appointments,
      outreachLog,
      documents,
      lastSyncAt: new Date().toISOString(),
      preferencesSnapshot: Object.fromEntries(enabled),
    }));
  } catch (err) { next(err); }
});

export default router;
