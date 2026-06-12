import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { multerUpload } from '../../middleware/uploadMiddleware';
import { blobStorage } from '../../shared/blobStorage';
import { CLINICAL_ROLES } from '../../shared/roleGroups';
import { AppError } from '../../shared/errors';

// BUG-636 — clinical-alert response shape SSoT (CLAUDE.md §5.2 + §5.3).
// Inline placement: NO frontend consumer today (frontend uses
// /reports/clinical-alerts from reportsRoutes.ts). Relocate to
// `packages/shared/src/schemas/clinicalAlerts.schema.ts` if a frontend
// consumer is later wired to /dashboard/clinical-alerts.
//
// The original handler had a fourth `overdue_review` variant referencing
// `e.next_review_date` — a GHOST COLUMN on `episodes`. Verified intent
// (per L4/L5 cycle-2 review 2026-05-01): MHA statutory reviews are the
// only "next review due" concept in the codebase, and they are tracked
// on `mha_reviews.next_review_date` + alerted via the dedicated
// `mhaReviewScheduler.ts` cron emitting to patient_alerts + SSE
// (BUG-372 closed). The dashboard's overdue_review variant was a
// silent-broken duplicate. Variant REMOVED entirely; if MHA-on-dashboard
// becomes a real product concept, see BUG-636-FOLLOWUP-MHA-DASHBOARD-VARIANT.
//
// Discriminated union on alertType pins variant fields exhaustively at
// compile + runtime — adding a 4th alert type forces a new schema branch
// AND a new mapper case (the switch is exhaustively typed).
const ClinicalAlertExpiringOrderSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string(),
  alertType: z.literal('expiring_order'),
  priority: z.enum(['high', 'medium', 'low']),
  genericName: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
const ClinicalAlertDueAssessmentSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string(),
  alertType: z.literal('due_assessment'),
  priority: z.enum(['high', 'medium', 'low']),
  assessmentType: z.string().nullable(),
  nextReviewAt: z.string().nullable(),
});
const ClinicalAlertDueSideEffectSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string(),
  alertType: z.literal('due_side_effect_monitoring'),
  priority: z.enum(['high', 'medium', 'low']),
  scheduleType: z.string().nullable(),
  nextDueDate: z.string().nullable(),
});
const ClinicalAlertSchema = z.discriminatedUnion('alertType', [
  ClinicalAlertExpiringOrderSchema,
  ClinicalAlertDueAssessmentSchema,
  ClinicalAlertDueSideEffectSchema,
]);
const ClinicalAlertsResponseSchema = z.object({
  data: z.array(ClinicalAlertSchema),
  total: z.number().int().nonnegative(),
});

// Date columns may arrive as Date instances (timestamptz) or strings
// (date). Normalise to ISO-8601 strings for the response so the frontend
// has one shape.
const toIsoString = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

function mapClinicalAlertRowToResponse(row: Record<string, unknown>): z.infer<typeof ClinicalAlertSchema> {
  const base = {
    patientId: String(row.patient_id),
    patientName: String(row.patient_name),
    priority: String(row.priority) as 'high' | 'medium' | 'low',
  };
  switch (row.alert_type) {
    case 'expiring_order':
      return {
        ...base, alertType: 'expiring_order',
        genericName: row.generic_name == null ? null : String(row.generic_name),
        expiresAt: toIsoString(row.expires_at),
      };
    case 'due_assessment':
      return {
        ...base, alertType: 'due_assessment',
        assessmentType: row.assessment_type == null ? null : String(row.assessment_type),
        nextReviewAt: toIsoString(row.next_review_at),
      };
    case 'due_side_effect_monitoring':
      return {
        ...base, alertType: 'due_side_effect_monitoring',
        scheduleType: row.schedule_type == null ? null : String(row.schedule_type),
        nextDueDate: toIsoString(row.next_due_date),
      };
    default:
      // AppError carries `code` field for observability dashboards to
      // alert on the mapper-drift class. The throw routes via the
      // route's outer try { ... } catch (err) { next(err); } to the
      // global error handler. Plain Error would lose the structured
      // code field.
      throw new AppError(
        `mapClinicalAlertRowToResponse: unknown alert_type ${String(row.alert_type)}`,
        500,
        'CLINICAL_ALERT_MAPPER_DRIFT',
      );
  }
}

const router = Router();

//  CROSS-ROLE ENDPOINTS (all authenticated clinical staff)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Patient Timeline ────────────────────────────────────────────────────────
// GET /patients/:id/timeline
router.get(
  '/patients/:id/timeline',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      interface TimelineEventRow {
        timestamp: string | Date | null;
        [key: string]: unknown;
      }

      const patientId = req.params.id;
      const limit = parseInt((req.query.limit as string) || '100', 10);
      const offset = parseInt((req.query.offset as string) || '0', 10);
      const typeFilter = req.query.type as string; // optional: notes, appointments, meds, etc.

      // Gather events from multiple sources in parallel
      const queries: Array<Promise<TimelineEventRow[]>> = [];

      if (!typeFilter || typeFilter === 'notes') {
        queries.push(
          dbRead('clinical_notes')
            .where({ patient_id: patientId, clinic_id: req.clinicId })
            .select(
              'id', 'note_type as type', 'title as summary',
              'created_at as timestamp', 'author_id as staff_id',
              db.raw("'note' as event_category"),
            )
            .orderBy('created_at', 'desc')
            .limit(limit),
        );
      }

      if (!typeFilter || typeFilter === 'appointments') {
        queries.push(
          dbRead('appointments')
            .where({ patient_id: patientId, clinic_id: req.clinicId })
            .select(
              'id', 'appointment_type as type', 'status as summary',
              'start_time as timestamp', 'clinician_id as staff_id',
              db.raw("'appointment' as event_category"),
            )
            .orderBy('start_time', 'desc')
            .limit(limit),
        );
      }

      if (!typeFilter || typeFilter === 'medications') {
        queries.push(
          dbRead('medication_administrations')
            .where({ patient_id: patientId, clinic_id: req.clinicId })
            .select(
              'id', db.raw("'med_admin' as type"),
              'notes as summary', 'administered_time as timestamp',
              'administered_by_staff_id as staff_id',
              db.raw("'medication' as event_category"),
            )
            .orderBy('administered_time', 'desc')
            .limit(limit),
        );
      }

      if (!typeFilter || typeFilter === 'contacts') {
        queries.push(
          dbRead('contact_records')
            .where({ patient_id: patientId, clinic_id: req.clinicId })
            .select(
              'id', 'contact_type as type', 'content as summary',
              'created_at as timestamp', 'staff_id',
              db.raw("'contact' as event_category"),
            )
            .orderBy('created_at', 'desc')
            .limit(limit),
        );
      }

      if (!typeFilter || typeFilter === 'observations') {
        queries.push(
          dbRead('structured_observations')
            .where({ patient_id: patientId, clinic_id: req.clinicId })
            .select(
              'id', 'observation_type as type', 'mood as summary',
              'observed_at as timestamp', 'staff_id',
              db.raw("'observation' as event_category"),
            )
            .orderBy('observed_at', 'desc')
            .limit(limit),
        );
      }

      if (!typeFilter || typeFilter === 'assessments') {
        queries.push(
          dbRead('nursing_assessments')
            .where({ patient_id: patientId, clinic_id: req.clinicId })
            .select(
              'id', 'assessment_type as type', 'notes as summary',
              'assessed_at as timestamp', 'staff_id',
              db.raw("'assessment' as event_category"),
            )
            .orderBy('assessed_at', 'desc')
            .limit(limit),
        );
      }

      const results: unknown[] = [];
      for (const query of queries) {
        // BUG-722: request-scoped RLS uses one transaction connection;
        // execute query fan-out sequentially.
        results.push(await query);
      }
      const toTimestamp = (value: unknown): number => {
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'string' || typeof value === 'number') {
          return new Date(value).getTime();
        }
        return 0;
      };
      const allEvents = (results.flat() as Array<Record<string, unknown>>)
        .sort((a, b) => toTimestamp(b.timestamp) - toTimestamp(a.timestamp))
        .slice(offset, offset + limit);

      res.json({ data: allEvents, total: allEvents.length, limit, offset });
    } catch (err) { next(err); }
  },
);

// ── Clinical Alerts Dashboard ───────────────────────────────────────────────
// GET /dashboard/clinical-alerts
router.get(
  '/dashboard/clinical-alerts',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const clinicId = req.clinicId;

      // Run alert queries in parallel.
      //
      // BUG-636 §1.4 closure (CLAUDE.md soft-delete discipline):
      //   - prescriptions: AND pr.deleted_at IS NULL
      //   - patients: AND p.deleted_at IS NULL on ALL THREE JOINs
      //     (sibling §1.4 gap on the join axis; soft-deleted patients
      //     with active children would otherwise surface attributed
      //     to deleted identity).
      //
      // BUG-636 ghost-column closure: the original handler had a fourth
      // `overdue_review` sub-query referencing `e.next_review_date` —
      // a GHOST COLUMN on `episodes` that has never existed. The intent
      // was MHA statutory reviews (already covered by mhaReviewScheduler.ts
      // emitting via SSE; BUG-372 closed). Variant REMOVED entirely —
      // see BUG-636-FOLLOWUP-MHA-DASHBOARD-VARIANT for the deferred
      // decision on whether the dashboard should also surface MHA
      // reviews via JOIN to mha_reviews.
      //
      // nursing_assessments + side_effect_schedules do NOT have
      // deleted_at columns (verified via schema-snapshot); their
      // queries don't filter on it. Adding it would fail
      // check-knex-column-references.
      const expiringOrders = await dbRead.raw(`
          SELECT p.id AS patient_id,
            p.given_name || ' ' || p.family_name AS patient_name,
            pr.generic_name,
            pr.expires_at,
            'expiring_order' AS alert_type,
            CASE WHEN pr.expires_at <= CURRENT_DATE THEN 'high' ELSE 'medium' END AS priority
          FROM prescriptions pr
          JOIN patients p ON p.id = pr.patient_id
          WHERE pr.clinic_id = ?
            AND pr.prescribed_by_staff_id = ?
            AND pr.status = 'active'
            AND pr.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND pr.expires_at <= CURRENT_DATE + INTERVAL '7 days'
          ORDER BY pr.expires_at ASC
          LIMIT 50
        `, [clinicId, userId]);

      // Due nursing assessments — uses next_review_at column added by
      // migration 20260701000003_nursing_assessment_review. A review is
      // "due" when next_review_at is ≤ 24 hours away (priority high if
      // already past). nursing_assessments has no deleted_at.
      const dueAssessments = await dbRead.raw(`
          SELECT na.patient_id,
            p.given_name || ' ' || p.family_name AS patient_name,
            na.assessment_type,
            na.next_review_at,
            'due_assessment' AS alert_type,
            CASE WHEN na.next_review_at < NOW() THEN 'high' ELSE 'medium' END AS priority
          FROM nursing_assessments na
          JOIN patients p ON p.id = na.patient_id
          WHERE na.clinic_id = ?
            AND p.deleted_at IS NULL
            AND na.next_review_at IS NOT NULL
            AND na.next_review_at <= NOW() + INTERVAL '24 hours'
            AND na.id = (
              SELECT na2.id FROM nursing_assessments na2
              WHERE na2.patient_id = na.patient_id
                AND na2.assessment_type = na.assessment_type
                AND na2.clinic_id = na.clinic_id
              ORDER BY na2.assessed_at DESC LIMIT 1
            )
          ORDER BY na.next_review_at ASC
          LIMIT 50
        `, [clinicId]);

      // Due side-effect monitoring. side_effect_schedules has no
      // deleted_at; status='active' is its semantic equivalent.
      const dueSideEffects = await dbRead.raw(`
          SELECT ses.patient_id,
            p.given_name || ' ' || p.family_name AS patient_name,
            ses.schedule_type,
            ses.next_due_date,
            'due_side_effect_monitoring' AS alert_type,
            CASE WHEN ses.next_due_date <= CURRENT_DATE THEN 'high' ELSE 'medium' END AS priority
          FROM side_effect_schedules ses
          JOIN patients p ON p.id = ses.patient_id
          WHERE ses.clinic_id = ?
            AND p.deleted_at IS NULL
            AND ses.status = 'active'
            AND ses.next_due_date <= CURRENT_DATE + 7
          ORDER BY ses.next_due_date ASC
          LIMIT 50
        `, [clinicId]);

      // BUG-636 §5.2 + §5.3 closure: snake_case row → camelCase
      // discriminated-union response. Map first, sort by priority,
      // Zod-parse the envelope at the boundary.
      const mapped = [
        ...expiringOrders.rows,
        ...dueAssessments.rows,
        ...dueSideEffects.rows,
      ].map(mapClinicalAlertRowToResponse);
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      mapped.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

      res.json(ClinicalAlertsResponseSchema.parse({ data: mapped, total: mapped.length }));
    } catch (err) { next(err); }
  },
);

// ── Notifications ───────────────────────────────────────────────────────────
// The previous three endpoints (GET /notifications, PATCH
// /notifications/:id/read, POST /notifications/mark-all-read) in this
// file have been removed in favour of the Phase 10A notification
// centre at /api/v1/notifications. That endpoint uses the same
// physical `notifications` table but routes through
// `notificationService.emit` and the shared Zod DTO so there's one
// source of truth for the bell UI, the SSE publish, and the durable
// log. See apps/api/src/features/notifications/notificationRoutes.ts.

// ── Patient Photo Upload ────────────────────────────────────────────────────
// POST /patients/:id/photo
//
// S1.1-DEFERRED-A: routes through the BlobStorage facade. The stored URL
// in `patients.photo_url` is the resolved download URL, which means:
//   - local backend: stays as `/uploads/patient-photos/...` (auth-gated
//     static serve, identical to legacy behaviour)
//   - cloud backend: becomes a signed URL that expires per the
//     facade's default TTL (5 minutes). Frontend should re-fetch the
//     patient row when it needs a fresh photo URL.
//
// Note: storing a presigned URL on the patient row is intentionally
// simple for now. If a hospital deploys with cloud blob storage
// and finds the 5-minute TTL too short, the right fix is to store
// only the storage_key on the patient row (new column) and resolve
// to a fresh URL on every read. That refactor is out of S1.1-DEFERRED-A.
router.post(
  '/patients/:id/photo',
  requireRoles([...CLINICAL_ROLES]),
  multerUpload.single('photo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = req.params.id;
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'Photo file is required (field: photo)' });
        return;
      }

      // Validate image type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        res.status(400).json({ error: 'Only JPEG, PNG, and WebP images are allowed' });
        return;
      }

      const ext = file.mimetype === 'image/png' ? 'png'
        : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const storageKey = `patient-photos/${patientId}-${Date.now()}.${ext}`;
      const put = await blobStorage.put(storageKey, file.buffer, file.mimetype);
      const photoUrl = await blobStorage.getDownloadUrl(put.key);

      // Phase 0.7.5 c24 D11 (SD52) — patients.photo_url added via
      // migration 20260603000002. The prior UPDATE crashed with
      // "column does not exist" because photo_url was a ghost column.
      // Explicit .returning list caps the PHI exposure — this endpoint
      // only needs to confirm the write, so we return the 2 fields the
      // handler actually uses (id + photo_url).
      const [updated] = await db('patients')
        .where({ id: patientId, clinic_id: req.clinicId })
        .update({ photo_url: photoUrl, updated_at: db.fn.now() })
        .returning(['id', 'photo_url']);

      if (!updated) {
        // Patient not found — delete the just-uploaded blob to avoid orphan
        try { await blobStorage.delete(put.key); } catch { /* best-effort */ }
        res.status(404).json({ error: 'Patient not found' });
        return;
      }

      res.json({ photoUrl, patientId });
    } catch (err) { next(err); }
  },
);

// ── Patient Barcode/QR ──────────────────────────────────────────────────────
// GET /patients/:id/barcode
router.get(
  '/patients/:id/barcode',
  requireRoles([...CLINICAL_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patient = await dbRead('patients')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .select('id', 'emr_number', 'given_name', 'family_name', 'date_of_birth')
        .first();

      if (!patient) {
        res.status(404).json({ error: 'Patient not found' });
        return;
      }

      // Return barcode data (frontend renders the actual barcode/QR)
      const barcodeData = {
        patientId: patient.id,
        emrNumber: patient.emr_number,
        givenName: patient.given_name,
        familyName: patient.family_name,
        dateOfBirth: patient.date_of_birth,
        barcodeValue: patient.emr_number,
        qrPayload: JSON.stringify({
          id: patient.id,
          emr: patient.emr_number,
          name: `${patient.family_name}, ${patient.given_name}`,
          dob: patient.date_of_birth,
        }),
      };

      res.json(barcodeData);
    } catch (err) { next(err); }
  },
);

export default router;
