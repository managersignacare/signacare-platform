/**
 * @admin-only — feature-flags-admin half (the public bootstrap GET /feature-flags has callers; the admin write surface does not)
 *
 * apps/api/src/features/feature-flags/featureFlagRoutes.ts
 *
 * S4.2 — Feature flag admin + frontend bootstrap endpoints.
 *
 * NOTE on the @admin-only sentinel: the file exports TWO routers. The
 * default `featureFlagRoutes` (the bootstrap GET that every web client
 * hits on app load) IS called and not subject to the rule. The named
 * `featureFlagAdminRouter` (mounted at /feature-flags-admin in server.ts)
 * is the operator-only surface that has no UI caller — it's used by
 * platform admins via curl to set per-clinic flag overrides. When a
 * dedicated flag-management UI ships, drop the sentinel. See
 * docs/admin-routes.md.
 *
 * Two surfaces:
 *
 *   GET  /feature-flags                  — bootstrap the frontend with
 *                                          the resolved flag map for
 *                                          the current clinic. Cheap,
 *                                          cached, called once on app
 *                                          load. No auth required for
 *                                          the read path because flag
 *                                          NAMES are not sensitive.
 *
 *   GET    /feature-flags-admin          — list flags + descriptions
 *                                          (admin only)
 *   PUT    /feature-flags-admin          — upsert a flag (admin only)
 *   DELETE /feature-flags-admin/:name    — delete a flag override
 *                                          (admin only)
 *
 * Naming compliance: route paths kebab-case, handler names camelCase,
 * DB columns snake_case (handled by the service).
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db } from '../../db/db';
import {
  isFeatureEnabled,
  listFeatureFlags,
  setFeatureFlag,
  deleteFeatureFlag,
  isValidFlagName,
} from '../../shared/featureFlags';
import { CreateFeatureFlagSchema } from '@signacare/shared';

// Audit Tier 5.1 — kill-switch safety rails. Disabling an `ai-*`
// flag is a clinic-wide service interruption; require a second admin
// to approve the request before the flag flips off. Same pattern as
// break-glass two-person authorisation.
const AI_FLAG_PREFIX = 'ai-';
function isAiFlag(name: string): boolean {
  return name.startsWith(AI_FLAG_PREFIX);
}
async function hasApprovedDisableRequest(
  flagName: string,
  clinicId: string | null,
): Promise<boolean> {
  const q = db('feature_flag_disable_requests')
    .where({ flag_name: flagName, action: 'disable', status: 'approved' });
  if (clinicId === null) q.whereNull('clinic_id');
  else q.where({ clinic_id: clinicId });
  const row = await q.orderBy('approved_at', 'desc').first();
  return !!row;
}

const router = Router();
router.use(authMiddleware, tenantMiddleware);

// GET /feature-flags — current resolved flag map for the active clinic
// Response shape:
//   { flags: { 'name-1': true, 'name-2': false, ... } }
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clinicId = req.clinicId ?? null;
    const all = await listFeatureFlags(clinicId);
    const out: Record<string, boolean> = {};
    for (const flag of all) {
      out[flag.name] = await isFeatureEnabled(flag.name, clinicId, { staffId: req.user?.id });
    }
    res.json({ flags: out });
  } catch (err) { next(err); }
});

// GET /feature-flags/:name — single-flag check (used by ad-hoc UI guards)
router.get('/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isValidFlagName(req.params.name)) {
      res.status(400).json({ error: 'invalid_flag_name' });
      return;
    }
    const enabled = await isFeatureEnabled(req.params.name, req.clinicId ?? null, { staffId: req.user?.id });
    res.json({ name: req.params.name, enabled });
  } catch (err) { next(err); }
});

export default router;

// ── Admin router (separate to keep the bootstrap endpoint unauth'd-by-role) ──

export const featureFlagAdminRouter = Router();
featureFlagAdminRouter.use(authMiddleware, tenantMiddleware, requireRoles(['admin', 'superadmin']));

featureFlagAdminRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flags = await listFeatureFlags(req.clinicId ?? null);
    res.json({ flags });
  } catch (err) { next(err); }
});

featureFlagAdminRouter.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto = CreateFeatureFlagSchema.parse(req.body);
    const { name, enabled, rolloutPercentage, description, scope } = dto;
    if (!isValidFlagName(name)) {
      res.status(400).json({ error: 'invalid_flag_name', message: 'name must match ^[a-z][a-z0-9-]{0,99}$' });
      return;
    }
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'invalid_request', message: 'enabled must be boolean' });
      return;
    }
    // scope='global' writes a global flag; otherwise the row is
    // tenant-specific to req.clinicId. Only superadmin can write
    // global rows because they affect every clinic.
    let clinicId: string | null;
    if (scope === 'global') {
      if (req.user?.role !== 'superadmin') {
        res.status(403).json({ error: 'global_flags_require_superadmin' });
        return;
      }
      clinicId = null;
    } else {
      clinicId = req.clinicId ?? null;
      if (!clinicId) {
        res.status(400).json({ error: 'no_clinic_context' });
        return;
      }
    }
    // Audit Tier 5.1 — `ai-*` flags require an approved disable-request
    // (from a different admin) before they can flip off. Enabling or
    // leaving enabled is unrestricted; only disable needs the gate.
    if (isAiFlag(name) && enabled === false) {
      const approved = await hasApprovedDisableRequest(name, clinicId);
      if (!approved) {
        res.status(409).json({
          error: 'ai_flag_disable_requires_approval',
          message: `Disabling '${name}' requires a second admin's approval. ` +
            `Open a disable-request first via POST /feature-flags-admin/disable-requests.`,
          code: 'REQUIRES_APPROVAL',
        });
        return;
      }
    }
    await setFeatureFlag({ name, enabled, rolloutPercentage, description, clinicId });
    res.status(204).end();
  } catch (err) { next(err); }
});

// ── AI disable-request two-person approval flow ───────────────────────────
// Only `ai-*` flags go through this. Admins open a request; a
// DIFFERENT admin approves or rejects. Approval does NOT flip the
// flag by itself — the admin who approved then calls PUT /feature-flags-admin
// with enabled=false which re-checks the approval row.

featureFlagAdminRouter.post('/disable-requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { flagName, scope, reason } = req.body ?? {};
    if (typeof flagName !== 'string' || !isValidFlagName(flagName)) {
      res.status(400).json({ error: 'invalid_flag_name' });
      return;
    }
    if (!isAiFlag(flagName)) {
      res.status(400).json({
        error: 'disable_request_only_for_ai_flags',
        message: 'Only ai-* flags require the 2-person disable flow.',
      });
      return;
    }
    let clinicId: string | null;
    if (scope === 'global') {
      if (req.user?.role !== 'superadmin') {
        res.status(403).json({ error: 'global_flags_require_superadmin' });
        return;
      }
      clinicId = null;
    } else {
      clinicId = req.clinicId ?? null;
    }
    const [row] = await db('feature_flag_disable_requests')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        flag_name: flagName,
        action: 'disable',
        requested_by_id: req.user!.id,
        requested_at: new Date(),
        status: 'pending',
        reason: typeof reason === 'string' ? reason : null,
        created_at: new Date(),
      })
      .returning(['id', 'clinic_id', 'flag_name', 'status', 'requested_by_id', 'requested_at']);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

featureFlagAdminRouter.get('/disable-requests', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = db('feature_flag_disable_requests')
      .where({ status: 'pending' })
      .orderBy('requested_at', 'desc')
      .limit(200);
    if (req.user?.role !== 'superadmin') {
      q.where({ clinic_id: req.clinicId });
    }
    const rows = await q.select();
    res.json({ requests: rows });
  } catch (err) { next(err); }
});

featureFlagAdminRouter.patch('/disable-requests/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { decision, rejectionReason } = req.body ?? {};
    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({ error: 'invalid_decision', message: 'decision must be approve or reject' });
      return;
    }
    const existing = await db('feature_flag_disable_requests').where({ id: req.params.id }).first();
    if (!existing) { res.status(404).json({ error: 'not_found' }); return; }
    if (existing.status !== 'pending') {
      res.status(409).json({ error: 'already_decided', status: existing.status });
      return;
    }
    if (existing.requested_by_id === req.user!.id) {
      res.status(403).json({
        error: 'self_approval_forbidden',
        message: 'A second admin must approve — the requester cannot approve their own request.',
      });
      return;
    }
    const patch: Record<string, unknown> = {
      status: decision === 'approve' ? 'approved' : 'rejected',
      approved_by_id: req.user!.id,
      approved_at: new Date(),
    };
    if (decision === 'reject') patch.rejection_reason = typeof rejectionReason === 'string' ? rejectionReason : null;
    await db('feature_flag_disable_requests').where({ id: req.params.id }).update(patch);
    res.json({ id: req.params.id, status: patch.status });
  } catch (err) { next(err); }
});

featureFlagAdminRouter.delete('/:name', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isValidFlagName(req.params.name)) {
      res.status(400).json({ error: 'invalid_flag_name' });
      return;
    }
    const scope = req.query.scope as string | undefined;
    let clinicId: string | null;
    if (scope === 'global') {
      if (req.user?.role !== 'superadmin') {
        res.status(403).json({ error: 'global_flags_require_superadmin' });
        return;
      }
      clinicId = null;
    } else {
      clinicId = req.clinicId ?? null;
    }
    await deleteFeatureFlag(req.params.name, clinicId);
    res.status(204).end();
  } catch (err) { next(err); }
});
