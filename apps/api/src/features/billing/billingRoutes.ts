import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRole } from '../../middleware/rbacMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import * as ctrl from './billingController';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
const ApplyUniformGapSchema = z.object({
  gapCents: z.number().int().nonnegative(),
});

const SuggestMbsSchema = z.object({
  appointmentId: z.string().uuid(),
});

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.BILLING));

// List all invoices for the clinic
router.get('/', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const clinicId = req.clinicId;
    const invoices = await db('invoices').where({ clinic_id: clinicId }).orderBy('created_at', 'desc').limit(100);
    res.json({ data: invoices });
  } catch (err) { next(err); }
});

// Billing accounts — one per patient per clinic
router.put(
  '/accounts',
  requireRole('admin', 'superadmin'),
  idempotencyMiddleware(),
  ctrl.upsertBillingAccount,
);
router.get('/accounts/patient/:patientId', ctrl.getBillingAccount);

// Invoices
router.post(
  '/invoices',
  requireRole('admin', 'superadmin', 'clinician', 'manager'),
  idempotencyMiddleware(),
  ctrl.createInvoice,
);
router.get('/invoices/patient/:patientId', ctrl.listInvoices);
router.get('/invoices/:invoiceId', ctrl.getInvoice);
router.delete(
  '/invoices/:invoiceId',
  requireRole('admin', 'superadmin'),
  idempotencyMiddleware(),
  ctrl.voidInvoice,
);

// Payments
router.post(
  '/payments',
  requireRole('admin', 'superadmin'),
  idempotencyMiddleware(),
  ctrl.recordPayment,
);
router.get('/invoices/:invoiceId/payments', ctrl.listPayments);
router.patch(
  '/payments/:paymentId/claim',
  requireRole('admin', 'superadmin'),
  idempotencyMiddleware(),
  ctrl.updateClaim,
);

// ── Fee Schedules (Power Settings) ────────────────────────────────────────

import { feeScheduleService } from './feeScheduleService';
import { clinicianFeeService } from './clinicianFeeService';
import { referralValidityService } from './referralValidityService';
import * as billingService from './billingService';
import { seedMbsItems } from '../../seed-mbs';
import type { Request, Response, NextFunction } from 'express';
import {
  FeeScheduleCreateSchema,
  FeeScheduleUpdateSchema,
  ClinicianFeeUpsertSchema,
  ReferralValidityCreateSchema,
  InvoiceApproveSchema,
} from '@signacare/shared';

router.get('/fee-schedules', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await feeScheduleService.list(req.clinicId, {
      category: req.query.category as string | undefined,
      isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
      source: req.query.source as string | undefined,
    });
    res.json({ items });
  } catch (err) { next(err); }
});

router.post('/fee-schedules', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = FeeScheduleCreateSchema.parse(req.body);
    const item = await feeScheduleService.create(req.clinicId, dto);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.put('/fee-schedules/:id', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = FeeScheduleUpdateSchema.parse(req.body);
    const item = await feeScheduleService.update(req.clinicId, req.params.id, dto);
    if (!item) { res.status(404).json({ error: 'Fee schedule item not found' }); return; }
    res.json(item);
  } catch (err) { next(err); }
});

router.delete('/fee-schedules/:id', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await feeScheduleService.deactivate(req.clinicId, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/fee-schedules/seed', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const count = await seedMbsItems(req.clinicId);
    res.json({ ok: true, inserted: count });
  } catch (err) { next(err); }
});

// ── Clinician Fee Overrides ───────────────────────────────────────────────

router.get('/clinician-fees/:staffId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await clinicianFeeService.list(req.clinicId, req.params.staffId);
    res.json({ items });
  } catch (err) { next(err); }
});

router.put('/clinician-fees/:staffId/:itemNumber', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = ClinicianFeeUpsertSchema.parse({ ...req.body, itemNumber: req.params.itemNumber });
    const result = await clinicianFeeService.upsert(req.clinicId, req.params.staffId, dto);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/clinician-fees/:staffId/:itemNumber', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await clinicianFeeService.remove(req.clinicId, req.params.staffId, req.params.itemNumber);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/clinician-fees/:staffId/apply-uniform-gap', requireRole('admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { gapCents } = ApplyUniformGapSchema.parse(req.body);
    await clinicianFeeService.applyUniformGap(req.clinicId, req.params.staffId, gapCents);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Invoice Approval Workflow ─────────────────────────────────────────────

router.post('/invoices/:invoiceId/approve', requireRole('clinician', 'admin', 'superadmin'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = InvoiceApproveSchema.parse(req.body);
    const invoice = await billingService.approveInvoice(req.clinicId, req.user!.id, req.params.invoiceId, dto);
    res.json(invoice);
  } catch (err) { next(err); }
});

router.post('/invoices/:invoiceId/send', requireRole('admin', 'superadmin', 'receptionist'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await billingService.markInvoiceSent(req.clinicId, req.params.invoiceId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Referral Validity ─────────────────────────────────────────────────────

router.get('/referrals/:patientId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const referral = await referralValidityService.getActive(req.clinicId, req.params.patientId);
    res.json({ referral });
  } catch (err) { next(err); }
});

router.get('/referrals/:patientId/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const referrals = await referralValidityService.listForPatient(req.clinicId, req.params.patientId);
    res.json({ items: referrals });
  } catch (err) { next(err); }
});

router.post('/referrals', requireRole('admin', 'receptionist', 'clinician'), idempotencyMiddleware(), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = ReferralValidityCreateSchema.parse(req.body);
    const referral = await referralValidityService.create(req.clinicId, dto);
    res.status(201).json(referral);
  } catch (err) { next(err); }
});

router.get('/referrals-expiring', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const daysAhead = parseInt(String(req.query.days ?? '30'), 10);
    const items = await referralValidityService.listExpiring(req.clinicId, daysAhead);
    res.json({ items });
  } catch (err) { next(err); }
});

// ── MBS Item Suggestion ──────────────────────────────────────────────────

router.post('/suggest-mbs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { appointmentId } = SuggestMbsSchema.parse(req.body);
    const { db: dbConn } = await import('../../db/db');
    const appt = await dbConn('appointments')
      .where({ id: appointmentId, clinic_id: req.clinicId })
      .first();
    if (!appt) { res.status(404).json({ error: 'Appointment not found' }); return; }
    const suggestion = await feeScheduleService.suggestMbsItem(req.clinicId, req.user!.id, {
      type: appt.type,
      startTime: appt.start_time instanceof Date ? appt.start_time.toISOString() : String(appt.start_time),
      endTime: appt.end_time instanceof Date ? appt.end_time.toISOString() : String(appt.end_time),
      patientId: appt.patient_id,
    });
    res.json({ suggestion });
  } catch (err) { next(err); }
});

export default router;
