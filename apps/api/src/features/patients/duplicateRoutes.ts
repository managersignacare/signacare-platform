// apps/api/src/features/patients/duplicateRoutes.ts
//
// S7.1 — Patient duplicate detection + merge endpoints.
//
// Routes:
//   POST   /api/v1/patients/duplicates/check   — score candidates for a registration payload
//   POST   /api/v1/patients/:id/merge          — merge a source patient into a destination (admin only)
//   GET    /api/v1/patients/:id/merges         — list merge events affecting this patient
//
// /duplicates/check is a POST (not GET) because the input contains PHI
// (Medicare, IHI, DVA, address) that must not appear in URL query strings
// — URLs end up in reverse-proxy access logs, browser history, and
// Sentry breadcrumbs. POST bodies stay TLS-encrypted and are not logged
// by any upstream we run.
//
// /merge enforces the 4-eyes principle indirectly: only admin/superadmin
// roles can call it, and every merge is logged in patient_merges with
// the merger's identity, reason, and a full JSONB snapshot of the
// source row for unwind.
//
// Fix Registry: DUP-RT1 (check endpoint), DUP-RT2 (merge endpoint with
// admin guard), DUP-RT3 (patient_merges snapshot recorded).

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  PatientDobSchema,
  PatientMedicareNumberSchema,
  PatientMedicareIrnSchema,
  PatientPhoneSchema,
} from '@signacare/shared';
import { db } from '../../db/db';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { HttpError } from '../../shared/errors';
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { findDuplicateCandidates } from './duplicateDetection';

const router = Router();

// ── Input schema for /duplicates/check ─────────────────────────────────────
const CheckInputSchema = z.object({
  givenName: z.string().min(1).max(120),
  familyName: z.string().min(1).max(120),
  dateOfBirth: PatientDobSchema,
  medicareNumber: PatientMedicareNumberSchema.nullish(),
  medicareIrn: PatientMedicareIrnSchema.nullish(),
  ihiNumber: z.string().max(20).nullish(),
  dvaNumber: z.string().max(20).nullish(),
  phoneMobile: PatientPhoneSchema.nullish(),
  addressLine1: z.string().max(200).nullish(),
  postcode: z.string().max(10).nullish(),
  excludePatientId: z.string().uuid().optional(),
});

router.post('/patients/duplicates/check', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = CheckInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const clinicId = req.clinicId;
    const { excludePatientId, ...input } = parsed.data;
    const candidates = await findDuplicateCandidates(clinicId, input, excludePatientId);
    res.json({ candidates, thresholdsUsed: { probable: 0.6, strong: 0.8, definite: 0.95 } });
  } catch (err) {
    next(err);
  }
});

// ── Merge two patients (admin only) ────────────────────────────────────────
const MergeInputSchema = z.object({
  sourcePatientId: z.string().uuid(),
  reason: z.string().min(10).max(1000),
});

router.post(
  '/patients/:id/merge',
  authMiddleware,
  tenantMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const destinationId = req.params.id;
      const parsed = MergeInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
      }
      const { sourcePatientId, reason } = parsed.data;
      if (sourcePatientId === destinationId) {
        throw new HttpError(400, 'INVALID_INPUT', 'source and destination must be distinct');
      }

      const clinicId = req.clinicId;
      const mergedBy = req.user!.id;

      // Load both rows under RLS to prove they both belong to this clinic.
      const source = await db('patients')
        .where({ id: sourcePatientId, clinic_id: clinicId })
        .whereNull('deleted_at')
        .first();
      const destination = await db('patients')
        .where({ id: destinationId, clinic_id: clinicId })
        .whereNull('deleted_at')
        .first();
      if (!source) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source patient not found in this clinic');
      if (!destination) {
        throw new HttpError(404, 'DESTINATION_NOT_FOUND', 'Destination patient not found in this clinic');
      }

      // Record the merge in a transaction. Everything happens under RLS.
      await db.transaction(async (trx) => {
        // 1. Snapshot the source row for unwind and forensics.
        await trx('patient_merges').insert({
          clinic_id: clinicId,
          source_patient_id: sourcePatientId,
          destination_patient_id: destinationId,
          merged_by: mergedBy,
          reason: reason.trim(),
          source_snapshot: JSON.stringify(source),
        });

        // 2. Soft-delete the source row. Clinical records attached to it
        //    remain queryable (RLS + the patient_merges row lets the UI
        //    display a "merged into X" banner) but the patient itself
        //    disappears from search / list endpoints that filter
        //    whereNull('deleted_at').
        await trx('patients')
          .where({ id: sourcePatientId, clinic_id: clinicId })
          .update({ deleted_at: new Date(), updated_at: new Date() });

        // 3. Clinical records (clinical_notes, episodes, medications,
        //    appointments, etc.) are NOT automatically re-pointed at the
        //    destination in this migration. That is a deliberate scope
        //    decision: automatic re-pointing is a complex data migration
        //    that can corrupt episode timelines if the two patients have
        //    overlapping admissions. Instead, the UI surfaces the merge
        //    and lets the clinician move individual records via the
        //    Transfer tool in a subsequent sprint. Fixing this properly
        //    requires a per-entity conflict review workflow, not a
        //    blanket UPDATE.

        // 4. Audit log entry for the merge.
        // BUG-467 L3-absorb — migrated from trx('audit_log').insert to
        // typed writeAuditLog. Note: writeAuditLog uses dbAdmin on a
        // separate connection; the audit row is written OUTSIDE this
        // transaction, which is the correct forensic-append semantic
        // — a rolled-back merge must still leave an audit record of
        // the ATTEMPTED merge for coronial reconstruction.
        await writeAuditLog({
          clinicId,
          actorId: mergedBy,
          tableName: 'patients',
          recordId: sourcePatientId,
          action: 'PATIENT_MERGED',
          newData: { destinationPatientId: destinationId, reason: reason.trim() },
        });
      });

      logger.warn(
        { sourcePatientId, destinationId, clinicId, mergedBy, reason: reason.trim() },
        'Patient merge completed',
      );

      res.json({
        sourcePatientId,
        destinationPatientId: destinationId,
        mergedAt: new Date().toISOString(),
        note:
          'Clinical records from the source have NOT been automatically re-pointed. Review the destination chart and use the Transfer tool to move individual records as appropriate.',
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── List merges affecting a patient ────────────────────────────────────────
router.get('/patients/:id/merges', authMiddleware, tenantMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId;
    const patientId = req.params.id;
    const rows = await db('patient_merges')
      .where({ clinic_id: clinicId })
      .andWhere((q) => q.where({ source_patient_id: patientId }).orWhere({ destination_patient_id: patientId }))
      .orderBy('created_at', 'desc');
    res.json({ merges: rows });
  } catch (err) {
    next(err);
  }
});

export default router;
