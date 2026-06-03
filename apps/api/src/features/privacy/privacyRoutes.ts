/**
 * Privacy & PII Management API Routes
 *
 * Implements Australian Privacy Act 1988 and Health Records Act 2001 (Vic) requirements:
 * - Data export (portability)
 * - Data anonymisation (right to erasure)
 * - Consent management
 * - Data breach logging
 * - Retention policy management
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../../db/db';
import logger from '../../utils/logger';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { isErr } from '@signacare/shared';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { anonymisePatientService } from './anonymisePatientService';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
// Privacy routes handle Privacy Act 1988 / Health Records Act 2001 submissions
// (anonymise, consent, breach log, data-sharing) — validate every shape.
const AnonymiseSchema = z.object({
  reason: z.string().min(5, 'Reason is required for anonymisation').max(2000),
});

const ConsentCreateSchema = z.object({
  patientId: z.string().uuid(),
  consentType: z.string().min(1).max(100),
  status: z.enum(['granted', 'withdrawn', 'pending']).optional(),
  witnessName: z.string().max(200).optional(),
  witnessRole: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  expiresAt: z.string().optional(),
});

const BreachLogSchema = z.object({
  breachType: z.string().min(1).max(100),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  description: z.string().min(1).max(5000),
  affectedRecords: z.number().int().nonnegative().optional(),
  affectedPatients: z.number().int().nonnegative().optional(),
  containmentActions: z.string().max(5000).optional(),
});

const DataSharingAgreementSchema = z.object({
  partnerName: z.string().min(1).max(200),
  partnerType: z.string().max(100).optional(),
  purpose: z.string().max(2000).optional(),
  dataCategories: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  conditions: z.string().max(5000).optional(),
  status: z.enum(['draft', 'active', 'expired', 'revoked']).optional(),
});

const router = Router();

// All privacy routes require authentication + admin/superadmin role
router.use(authMiddleware);
router.use(requireRoles(['admin', 'superadmin']));

// Explicit column lists for .returning() (Phase R3 / CLAUDE.md §1.7).
// Section P of the baseline migration added these 4 tables —
// pre-R3 the privacy routes wrote to tables that didn't exist.
const CONSENT_RECORD_COLUMNS = [
  'id', 'clinic_id', 'patient_id', 'consent_type', 'status',
  'granted_at', 'withdrawn_at', 'expires_at',
  'witness_name', 'witness_role', 'notes', 'recorded_by_id',
  'created_at', 'updated_at',
] as const;
const DATA_BREACH_LOG_COLUMNS = [
  'id', 'clinic_id', 'breach_type', 'severity', 'description',
  'affected_records', 'affected_patients', 'containment_actions',
  'reported_by_id', 'detected_at', 'reported_at', 'status',
  'resolution_notes', 'is_notifiable', 'notification_deadline',
  'oaic_form_data', 'created_at', 'updated_at',
] as const;
const DATA_SHARING_AGREEMENT_COLUMNS = [
  'id', 'clinic_id', 'partner_name', 'partner_type', 'purpose',
  'data_categories', 'start_date', 'end_date', 'conditions',
  'status', 'approved_by_id', 'created_at', 'updated_at',
] as const;

// GET /api/v1/privacy/patient/:patientId/export — Export all patient data (portability)
router.get('/patient/:patientId/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { patientId } = req.params;
    const clinicId = req.clinicId;

    // Verify patient belongs to this clinic
    const patient = await db('patients').where({ id: patientId, clinic_id: clinicId }).first();
    if (!patient) { res.status(404).json({ error: 'Patient not found' }); return; }

    // Use the database export function
    const result = await db.raw('SELECT export_patient_data(?) as data', [patientId]);
    const data = result.rows[0]?.data;

    logger.info({ patientId, clinicId, userId: req.user?.id }, 'Patient data exported');

    res.json({
      exportDate: new Date().toISOString(),
      format: 'json',
      patient: patientId,
      data,
    });
  } catch (err) { next(err); }
});

// POST /api/v1/privacy/patient/:patientId/anonymise — Anonymise patient record
//
// BUG-374b — replaces the prior call to ghost SQL function
// `anonymise_patient(uuid, reason)` (verified non-existent → BUG-594)
// with the canonical TS service `anonymisePatientService.anonymise`.
// The service enforces superadmin-only role per Q3(b), is idempotent on
// already-purged patients per Q-E, and writes an audit_log entry per
// anonymisation. Free-text in clinical_notes is preserved as clinical
// record per Q-C — patient identity wipe only.
router.post('/patient/:patientId/anonymise', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { patientId } = req.params;
    const { reason } = AnonymiseSchema.parse(req.body);
    const auth = buildAuthContext(req);

    const result = await anonymisePatientService.anonymise(auth, patientId, reason);
    if (isErr(result)) return next(result.error);

    logger.warn(
      { patientId, clinicId: auth.clinicId, userId: auth.staffId, reason, mutated: result.value.mutated },
      'Patient record anonymised',
    );

    res.json({
      success: true,
      mutated: result.value.mutated,
      scrubberVersion: result.value.scrubberVersion,
      message: result.value.mutated
        ? 'Patient record anonymised. Clinical structure preserved, PII removed.'
        : 'Patient was already anonymised; no change applied.',
    });
  } catch (err) { next(err); }
});

// GET /api/v1/privacy/consent/:patientId — Get consent records for a patient.
// Returns the standard `{ data: [...] }` envelope so the shape is
// consistent with every other list endpoint in the API. The camelCase
// response middleware converts each record's snake_case columns
// (consent_type, granted_at, ...) to camelCase at the HTTP boundary,
// so the GET output round-trips with the POST input field names.
router.get('/consent/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const records = await db('consent_records')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .orderBy('created_at', 'desc');
    res.json({ data: records, total: records.length });
  } catch (err) { next(err); }
});

// POST /api/v1/privacy/consent — Record a new consent
router.post('/consent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { patientId, consentType, status, witnessName, witnessRole, notes, expiresAt } = ConsentCreateSchema.parse(req.body);
    const [record] = await db('consent_records').insert({
      patient_id: patientId,
      clinic_id: req.clinicId,
      consent_type: consentType,
      status: status || 'granted',
      granted_at: status === 'granted' ? new Date() : null,
      withdrawn_at: status === 'withdrawn' ? new Date() : null,
      expires_at: expiresAt || null,
      witness_name: witnessName || null,
      witness_role: witnessRole || null,
      notes: notes || null,
      recorded_by_id: req.user?.id,
    }).returning(CONSENT_RECORD_COLUMNS);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// GET /api/v1/privacy/retention — Get data retention policies
router.get('/retention', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policies = await db('data_retention_policies')
      .where({ clinic_id: req.clinicId, is_active: true })
      .orderBy('data_category');
    res.json({ policies });
  } catch (err) { next(err); }
});

// GET /api/v1/privacy/breaches — List data breaches
router.get('/breaches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const breaches = await db('data_breach_log')
      .where({ clinic_id: req.clinicId })
      .orderBy('detected_at', 'desc');
    res.json({ breaches });
  } catch (err) { next(err); }
});

// POST /api/v1/privacy/breaches — Log a data breach
router.post('/breaches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { breachType, severity, description, affectedRecords, affectedPatients, containmentActions } = BreachLogSchema.parse(req.body);
    const [breach] = await db('data_breach_log').insert({
      clinic_id: req.clinicId,
      breach_type: breachType,
      severity: severity || 'medium',
      description,
      affected_records: affectedRecords || 0,
      affected_patients: affectedPatients || 0,
      containment_actions: containmentActions,
      reported_by_id: req.user?.id,
    }).returning(DATA_BREACH_LOG_COLUMNS);

    logger.error({ breachId: breach.id, severity, breachType }, 'DATA BREACH LOGGED');

    res.status(201).json(breach);
  } catch (err) { next(err); }
});

// ── Data Sharing Agreements (Privacy Act 2024) ──────────────────────────────
// Manages agreements for inter-provider data sharing (referrals, shared care, etc.)

router.get('/data-sharing-agreements', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    const agreements = await db('data_sharing_agreements')
      .where({ clinic_id: req.clinicId })
      .orderBy('created_at', 'desc');
    res.json({ agreements });
  } catch (_err) {
    // Table may not exist yet — return empty
    res.json({ agreements: [] });
  }
});

router.post('/data-sharing-agreements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partnerName, partnerType, purpose, dataCategories, startDate, endDate, conditions, status } = DataSharingAgreementSchema.parse(req.body);

    // Phase R3: table now exists as part of baseline Section P — the
    // pre-R2 schema-creation-in-route-handler pattern (CLAUDE.md §7.3
    // forbids DDL in routes) has been removed.
    const [agreement] = await db('data_sharing_agreements').insert({
      clinic_id: req.clinicId,
      partner_name: partnerName,
      partner_type: partnerType,
      purpose,
      data_categories: JSON.stringify(dataCategories ?? []),
      start_date: startDate,
      end_date: endDate,
      conditions,
      status: status ?? 'draft',
      approved_by_id: req.user!.id,
    }).returning(DATA_SHARING_AGREEMENT_COLUMNS);

    res.status(201).json(agreement);
  } catch (err) { next(err); }
});

export default router;
