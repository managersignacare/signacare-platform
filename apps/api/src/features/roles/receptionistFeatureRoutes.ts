// @jsonb-extraction-exempt: role-based SQL projection is the privacy boundary;
// receptionist projection (PHONE_TRIAGE_COLUMNS_REDACTED) intentionally omits
// clinical_risk_flags entirely so receptionist-only callers cannot see
// nurse-entered risk assessments via any response shape; nurse projection
// (PHONE_TRIAGE_COLUMNS_FULL) returns clinical_risk_flags as raw JSONB for
// downstream nurse-UI parser. A *ToResponse extraction would push role-
// sensitive behavior into a mapper and risk weakening or obscuring the
// SQL-layer privacy mechanism. Phase 0b.1c design-scope exemption (operator-
// authorized 2026-05-04), NOT a temporary band-aid.
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { PatientDobSchema, PatientPhoneSchema } from '@signacare/shared';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbRead } from '../../db/db';
import { RECEPTIONIST_ROLES, NURSE_ROLES } from '../../shared/roleGroups';
import { AppError, ErrorCode } from '../../shared/errors';
import { ensureInitialTeamAssignmentForPatient } from '../patients/patientInitialTeamAssignment';

// Local Zod schema for the quick-register endpoint (Phase R3b / CLAUDE.md §12).
const QuickRegisterSchema = z.object({
  givenName: z.string().min(1).max(100),
  familyName: z.string().min(1).max(100),
  dateOfBirth: PatientDobSchema,
  phoneMobile: PatientPhoneSchema.optional(),
});

const CheckInOutstandingResponseSchema = z.object({
  appointmentId: z.string().uuid(),
  patientId: z.string().uuid().nullable(),
  checkInAt: z.string().nullable(),
  checkedInById: z.string().uuid().nullable(),
  outstanding: z.object({
    invoices: z.number().int().nonnegative(),
    flags: z.number().int().nonnegative(),
    referrals: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});

function toNullableIsoString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

// Audit Tier 1.4 (CRIT-H2 / GAP-B2) — role-scoped Zod schemas for the
// phone_triage split. The receptionist intake form writes only
// receptionist_summary (free text describing what the caller said + any
// action taken). It MUST NOT write clinical_risk_flags — that column is
// nurse-only and has its own route + schema in nurseFeatureRoutes.ts.
// Shared Zod would let the FE call either variant; keeping them separate
// makes the role boundary testable at the schema level.
const ReceptionistTriageCreateSchema = z.object({
  patientId: z.string().uuid().optional(),
  callerName: z.string().min(1).max(200),
  callerRelationship: z.string().max(100).optional(),
  callerPhone: z.string().max(30).optional(),
  reasonForCall: z.string().min(1),
  urgency: z.enum(['urgent', 'semi-urgent', 'routine']).optional(),
  receptionistSummary: z.string().max(10000).optional(),
  actionTaken: z.string().max(10000).optional(),
  assignedToId: z.string().uuid().optional(),
});

const ReceptionistTriageUpdateSchema = z.object({
  // BUG-PR-R1-12-FIX-S1-phone_triage — REQUIRED expectedLockVersion.
  expectedLockVersion: z.number().int().positive(),
  receptionistSummary: z.string().max(10000).nullable().optional(),
  actionTaken: z.string().max(10000).nullable().optional(),
  urgency: z.enum(['urgent', 'semi-urgent', 'routine']).optional(),
  status: z.string().max(30).optional(),
  assignedToId: z.string().uuid().nullable().optional(),
});

const router = Router();

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// phone_triage is materialized in R2b baseline — pre-R2 it was a ghost
// table silently targeted by this router. Added here alongside the
// existing APPOINTMENT_COLUMNS. The Phase F markers on the
// phone_triage sites have been removed.
// Full column set — includes the Tier 1.4 split columns
// `receptionist_summary` + `clinical_risk_flags`. Returned only for
// NURSE_ROLES; non-nurse callers get the redacted projection below.
// @column-list-projection-exempt: paired projection mechanism — FULL and
// REDACTED are deliberately hand-maintained as a privacy boundary. FULL
// returns clinical_risk_flags (nurse-only); REDACTED omits it for
// receptionist-only callers. Replacing FULL with auto-generated
// PHONE_TRIAGE_COLUMNS would couple the two so adding any future column
// to phone_triage would automatically expose it to non-nurse callers via
// the REDACTED list omission rule. The hand-maintained pair is the
// canonical mechanism per Phase 0b.1c privacy-boundary discussion.
const PHONE_TRIAGE_COLUMNS_FULL = [
  'id', 'clinic_id', 'patient_id', 'caller_name', 'caller_relationship',
  'caller_phone', 'reason_for_call', 'urgency', 'triage_notes',
  'receptionist_summary', 'clinical_risk_flags',
  'action_taken', 'assigned_to_id', 'received_by_id', 'triaged_by_staff_id',
  'status', 'created_at', 'updated_at',
] as const;

// Redacted projection for non-NURSE_ROLES callers — strips
// `clinical_risk_flags` so receptionist-only staff never see nurse-entered
// risk assessments. `triage_notes` still returned so legacy rows remain
// visible. Align this list with the FULL list any time the schema changes.
// @column-list-projection-exempt: privacy-redacted projection — clinical_risk_flags
// intentionally omitted for non-NURSE_ROLES callers. This is the SQL-layer
// privacy boundary (paired with PHONE_TRIAGE_COLUMNS_FULL above). The fix-
// registry anchor R-FIX-PHASE-0B.1C-RECEPTIONIST-JSONB-EXEMPT pins the
// surrounding privacy-mechanism context.
const PHONE_TRIAGE_COLUMNS_REDACTED = [
  'id', 'clinic_id', 'patient_id', 'caller_name', 'caller_relationship',
  'caller_phone', 'reason_for_call', 'urgency', 'triage_notes',
  'receptionist_summary',
  'action_taken', 'assigned_to_id', 'received_by_id', 'triaged_by_staff_id',
  'status', 'created_at', 'updated_at',
  'lock_version', // BUG-PR-R1-12-FIX-S1-phone_triage
] as const;

function isNurseRole(role: string | undefined): boolean {
  return NURSE_ROLES.includes(role as typeof NURSE_ROLES[number]);
}

const APPOINTMENT_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'clinician_id', 'staff_id',
  'episode_id', 'start_time', 'end_time', 'appointment_start',
  'appointment_end', 'duration_minutes', 'status', 'type',
  'appointment_type', 'mode', 'mbs_item', 'patient_response', 'location',
  'notes', 'telehealth', 'telehealth_url', 'telehealth_link',
  'telehealth_provider', 'telehealth_passcode', 'cancellation_reason',
  'cancelled_by_id', 'rescheduled_from_id', 'reminder_scheduled',
  'reminder_sent', 'reminder_sent_at', 'outlook_event_id', 'created_at',
  'updated_at', 'deleted_at', 'recurrence_rule', 'recurrence_end_date',
  'recurrence_parent_id', 'specialty_code', 'check_in_at', 'checked_in_by_id',
  'lock_version',
] as const;

// Quick-register path uses a subset of the full patients schema
// (the full 63-col list lives in patientRepository/patientRoutes; here
// we only need the cols the handler response uses).
const PATIENT_QUICK_REGISTER_COLUMNS = [
  'id', 'clinic_id', 'emr_number', 'given_name', 'family_name',
  'date_of_birth', 'phone_mobile', 'status', 'created_at', 'updated_at',
] as const;

const OUTSTANDING_INVOICE_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'unpaid',
  'partially_paid',
  'overdue',
] as const;

const CLOSED_REFERRAL_STATUSES = [
  'rejected',
  'redirected',
  'closed_no_response',
  'expired',
  'appointment_booked',
] as const;

const PENDING_ATTACHMENT_OCR_STATUSES = ['pending', 'processing', 'failed'] as const;

function toCount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

type OutstandingCounts = {
  invoices: number;
  flags: number;
  referrals: number;
  documents: number;
  total: number;
};

async function loadOutstandingCounts(clinicId: string, patientId: string): Promise<OutstandingCounts> {
  // Run sequentially: request-scoped clinic/RLS context can pin calls to a
  // single pg client; concurrent query dispatch on the same client emits
  // pg@9 deprecation warnings and can become brittle under upgrades.
  const invoiceCountRow = await dbRead('invoices')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereIn('status', OUTSTANDING_INVOICE_STATUSES)
    .count<{ count: string }>({ count: '*' })
    .first();

  const activeFlagsRow = await dbRead('patient_flags')
    .where({ clinic_id: clinicId, patient_id: patientId, status: 'active' })
    .whereNull('deleted_at')
    .count<{ count: string }>({ count: '*' })
    .first();

  const openReferralsRow = await dbRead('referrals')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .whereNull('deleted_at')
    .whereNotIn('status', CLOSED_REFERRAL_STATUSES)
    .count<{ count: string }>({ count: '*' })
    .first();

  const pendingDocsRow = await dbRead('referral_attachments as ra')
    .join('referrals as r', 'ra.referral_id', 'r.id')
    .where({
      'ra.clinic_id': clinicId,
      'r.clinic_id': clinicId,
      'r.patient_id': patientId,
    })
    .whereNull('ra.deleted_at')
    .whereNull('r.deleted_at')
    .whereIn('ra.ocr_status', PENDING_ATTACHMENT_OCR_STATUSES)
    .count<{ count: string }>({ count: 'ra.id' })
    .first();

  const invoices = toCount(invoiceCountRow?.count);
  const flags = toCount(activeFlagsRow?.count);
  const referrals = toCount(openReferralsRow?.count);
  const documents = toCount(pendingDocsRow?.count);

  return {
    invoices,
    flags,
    referrals,
    documents,
    total: invoices + flags + referrals + documents,
  };
}


// ── Appointment Check-In ────────────────────────────────────────────────────
// POST /appointments/:id/check-in
router.post(
  '/appointments/:id/check-in',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const [updated] = await db('appointments')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .update({
          status: 'arrived',
          check_in_at: db.fn.now(),
          checked_in_by_id: req.user!.id,
          lock_version: db.raw('lock_version + 1'),
          updated_at: db.fn.now(),
        })
        .returning(APPOINTMENT_COLUMNS);

      if (!updated) {
        res.status(404).json({ error: 'Appointment not found' });
        return;
      }
      res.json(updated);
    } catch (err) { next(err); }
  },
);

// GET /appointments/:id/check-in-outstanding
router.get(
  '/appointments/:id/check-in-outstanding',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appt = await dbRead('appointments')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .first('id', 'patient_id', 'check_in_at', 'checked_in_by_id');

      if (!appt) {
        return next(new AppError('Appointment not found', 404, ErrorCode.NOT_FOUND));
      }

      const patientId = (appt['patient_id'] as string | null) ?? null;
      const outstanding = patientId
        ? await loadOutstandingCounts(req.clinicId, patientId)
        : { invoices: 0, flags: 0, referrals: 0, documents: 0, total: 0 };

      res.json(CheckInOutstandingResponseSchema.parse({
        appointmentId: appt['id'],
        patientId,
        checkInAt: toNullableIsoString(appt['check_in_at']),
        checkedInById: appt['checked_in_by_id'] ?? null,
        outstanding,
      }));
    } catch (err) { next(err); }
  },
);

// ── Quick Patient Registration ──────────────────────────────────────────────
// POST /patients/quick-register
router.post(
  '/patients/quick-register',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { givenName, familyName, dateOfBirth, phoneMobile } = QuickRegisterSchema.parse(req.body);

      const id = randomUUID();
      const emrNumber = `NOU-${Date.now().toString(36).toUpperCase()}`;
      const [patient] = await db.transaction(async (trx) => {
        const created = await trx('patients')
          .insert({
            id,
            clinic_id: req.clinicId,
            given_name: givenName,
            family_name: familyName,
            date_of_birth: dateOfBirth,
            phone_mobile: phoneMobile || null,
            emr_number: emrNumber,
            status: 'active',
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning(PATIENT_QUICK_REGISTER_COLUMNS);

        if (typeof req.user?.id === 'string' && req.user.id.length > 0) {
          await ensureInitialTeamAssignmentForPatient({
            trx,
            clinicId: req.clinicId,
            patientId: id,
            staffId: req.user.id,
          });
        }

        return created;
      });

      res.status(201).json(patient);
    } catch (err) { next(err); }
  },
);

// ── Waitlist Positions ──────────────────────────────────────────────────────
// GET /waitlist/positions
router.get(
  '/waitlist/positions',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      interface WaitlistPositionRow {
        [key: string]: unknown;
      }

      const rows = await dbRead('waitlist_entries as w')
        .where({ 'w.clinic_id': req.clinicId, 'w.status': 'waiting' })
        .leftJoin('patients as p', 'w.patient_id', 'p.id')
        .select(
          'w.*',
          'p.given_name',
          'p.family_name',
          'p.emr_number',
        )
        .orderBy('w.priority', 'desc')
        .orderBy('w.created_at', 'asc');

      const data = (rows as WaitlistPositionRow[]).map((row, idx: number) => ({ ...row, position: idx + 1 }));
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// ── Phone Triage CRUD ───────────────────────────────────────────────────────
// Tier 1.4 (CRIT-H2 / GAP-B2): receptionist POST/PUT writes
// `receptionist_summary` only. `clinical_risk_flags` is nurse-only and
// lives on PATCH /phone-triage/:id/clinical-triage in nurseFeatureRoutes.
// GET /phone-triage is role-gated to NURSE_ROLES ∪ RECEPTIONIST_ROLES
// but the response projection strips clinical_risk_flags for non-nurse
// callers so receptionist-only staff never see nurse-entered risk.
//
// GET /phone-triage
router.get(
  '/phone-triage',
  requireRoles([...RECEPTIONIST_ROLES, ...NURSE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, status, limit = '50' } = req.query;
      const projection = isNurseRole(req.user?.role)
        ? PHONE_TRIAGE_COLUMNS_FULL
        : PHONE_TRIAGE_COLUMNS_REDACTED;

      let query = dbRead('phone_triage')
        .where({ clinic_id: req.clinicId })
        .select(projection)
        .orderBy('created_at', 'desc')
        .limit(parseInt(limit as string, 10));

      if (patientId) query = query.where({ patient_id: patientId });
      if (status) query = query.where({ status });

      const data = await query;
      res.json({ data });
    } catch (err) { next(err); }
  },
);

// POST /phone-triage — receptionist intake path. Writes only admin-scope
// columns + the new `receptionist_summary`. The legacy `triage_notes`
// column is no longer written on this path (it is kept for legacy-row
// reads via the redacted projection above; new risk data belongs on
// clinical_risk_flags written by the nurse route).
router.post(
  '/phone-triage',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ReceptionistTriageCreateSchema.parse(req.body);

      const [row] = await db('phone_triage')
        .insert({
          id: randomUUID(),
          clinic_id: req.clinicId,
          patient_id: dto.patientId || null,
          caller_name: dto.callerName,
          caller_relationship: dto.callerRelationship || null,
          caller_phone: dto.callerPhone || null,
          reason_for_call: dto.reasonForCall,
          urgency: dto.urgency || 'routine',
          receptionist_summary: dto.receptionistSummary || null,
          action_taken: dto.actionTaken || null,
          assigned_to_id: dto.assignedToId || null,
          received_by_id: req.user!.id,
          triaged_by_staff_id: req.user!.id,
          status: 'open',
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning(PHONE_TRIAGE_COLUMNS_REDACTED);

      res.status(201).json(row);
    } catch (err) { next(err); }
  },
);

// PUT /phone-triage/:id — receptionist update. Only admin-scope fields
// + receptionist_summary. Nurses editing clinical_risk_flags use the
// PATCH /phone-triage/:id/clinical-triage route in nurseFeatureRoutes.ts.
router.put(
  '/phone-triage/:id',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = ReceptionistTriageUpdateSchema.parse(req.body);
      const patch: Record<string, unknown> = {};
      if (dto.receptionistSummary !== undefined) patch.receptionist_summary = dto.receptionistSummary;
      if (dto.actionTaken !== undefined) patch.action_taken = dto.actionTaken;
      if (dto.urgency !== undefined) patch.urgency = dto.urgency;
      if (dto.status !== undefined) patch.status = dto.status;
      if (dto.assignedToId !== undefined) patch.assigned_to_id = dto.assignedToId;

      // BUG-PR-R1-12-FIX-S1-phone_triage — opt-locked UPDATE.
      const { updateWithOptimisticLock } = await import('../../shared/db/optimisticLock');
      const row = await updateWithOptimisticLock<Record<string, unknown>>({
        table: 'phone_triage',
        where: { id: req.params.id, clinic_id: req.clinicId },
        expectedLockVersion: dto.expectedLockVersion,
        patch,
        returning: PHONE_TRIAGE_COLUMNS_REDACTED,
      });
      res.json(row);
    } catch (err) { next(err); }
  },
);

// DELETE /phone-triage/:id
router.delete(
  '/phone-triage/:id',
  requireRoles([...RECEPTIONIST_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deleted = await db('phone_triage')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .del();
      if (!deleted) { res.status(404).json({ error: 'Not found' }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  },
);


export default router;
