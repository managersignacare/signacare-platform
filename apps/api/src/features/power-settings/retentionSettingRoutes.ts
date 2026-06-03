// apps/api/src/features/power-settings/retentionSettingRoutes.ts
//
// BUG-374a — retention-configuration HTTP routes.
//
// Mount-point: nested under /api/v1/power-settings (see
// powerSettingsRoutes.ts for the parent mount + authMiddleware +
// tenantMiddleware). Per Q3b, the SETTERS are restricted to
// `superadmin` role; the GET endpoint is admin-readable so
// clinic admins can SEE the retention policy without being able
// to change it.
//
// fix-registry anchors: R-FIX-BUG-374A-ZOD-MIN-25,
// R-FIX-BUG-374A-SUPERADMIN-GUARD.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/rbacMiddleware';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { isErr } from '@signacare/shared';
import {
  retentionSettingService,
  DATA_RETENTION_YEARS_FLOOR,
  DATA_RETENTION_YEARS_CEILING,
} from './retentionSettingService';
import {
  retentionApprovalService,
  MANAGER_APPROVAL_TTL_DAYS,
} from './retentionApprovalService';

export const retentionSettingRoutes = Router();

// Zod schema with min(25) per BUG-374 25-year floor (Q1b locked).
// L1+L2 defence layer; service layer (L3) re-validates; DB CHECK (L4)
// is the final guard.
const SetRetentionYearsSchema = z.object({
  years: z
    .number()
    .int()
    .min(DATA_RETENTION_YEARS_FLOOR)
    .max(DATA_RETENTION_YEARS_CEILING),
});

const SetPurgeEnabledSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().min(1).max(500),
});

// GET /power-settings/retention — admin-readable
retentionSettingRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = buildAuthContext(req);
    const r = await retentionSettingService.getRetention(auth);
    if (isErr(r)) return next(r.error);
    // BUG-374b Part 2 — surface the manager-approval state for the UI
    // panel. L5 absorb-1: consume the canonical
    // `retentionApprovalService.getState` reader so this route never
    // inlines a `dbAdmin('clinics')` SELECT. The reader also
    // server-computes `managerApprovalActive` so the UI does not
    // re-derive the predicate (eliminates BUG-416 anti-pattern shape +
    // browser-vs-server clock drift on a destructive surface).
    const approvalR = await retentionApprovalService.getState(auth);
    if (isErr(approvalR)) return next(approvalR.error);

    // Compute remaining-days from the same server clock so countdown
    // matches the cron-evaluated TTL exactly.
    const approvedAt = approvalR.value.retentionPurgeManagerApprovedAt;
    const ttlMs = MANAGER_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;
    const remainingMs = approvedAt
      ? Math.max(0, ttlMs - (Date.now() - approvedAt.getTime()))
      : null;
    const managerApprovalRemainingDays = remainingMs === null
      ? null
      : Math.floor(remainingMs / (24 * 60 * 60 * 1000));

    res.json({
      dataRetentionYears: r.value.dataRetentionYears,
      retentionPurgeEnabled: r.value.retentionPurgeEnabled,
      retentionPurgeEnabledAt: r.value.retentionPurgeEnabledAt?.toISOString() ?? null,
      retentionPurgeEnabledByStaffId: r.value.retentionPurgeEnabledByStaffId,
      retentionPurgeManagerApprovedByStaffId: approvalR.value.retentionPurgeManagerApprovedByStaffId,
      retentionPurgeManagerApprovedAt: approvalR.value.retentionPurgeManagerApprovedAt?.toISOString() ?? null,
      managerApprovalActive: approvalR.value.managerApprovalActive,
      managerApprovalTtlDays: MANAGER_APPROVAL_TTL_DAYS,
      managerApprovalRemainingDays,
      floorYears: DATA_RETENTION_YEARS_FLOOR,
      ceilingYears: DATA_RETENTION_YEARS_CEILING,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /power-settings/retention — superadmin only
retentionSettingRoutes.put(
  '/',
  requireRole('superadmin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SetRetentionYearsSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const r = await retentionSettingService.setRetention(auth, parsed.years);
      if (isErr(r)) return next(r.error);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /power-settings/retention/purge-enabled — superadmin only
retentionSettingRoutes.put(
  '/purge-enabled',
  requireRole('superadmin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = SetPurgeEnabledSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const r = await retentionSettingService.setPurgeEnabled(
        auth,
        parsed.enabled,
        parsed.reason,
      );
      if (isErr(r)) return next(r.error);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
