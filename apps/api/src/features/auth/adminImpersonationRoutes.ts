// apps/api/src/features/auth/adminImpersonationRoutes.ts
//
// Tier 12.13 — admin impersonation for audit review.
//
// A superadmin or medical director may briefly assume a clinician's
// identity (≤15 min) so the admin-side UI can reproduce exactly what
// the clinician sees. Every downstream audit_log row written during
// the impersonation window records BOTH the impersonated clinician
// (as the `staff_id`) AND the admin (via a dedicated `impersonator_id`
// column appended by adminImpersonationAuditMiddleware).
//
// Flow:
//   1. POST /admin/impersonate/:staffId { reason } — admin starts a
//      session; server creates a row in admin_impersonation_sessions,
//      mints a short-lived JWT carrying `impersonator: <adminId>` +
//      `impersonationSessionId: <rowId>`, returns { token, expiresAt }.
//   2. POST /admin/impersonate/:id/end — admin (or the impersonated
//      user) ends the session early.
//   3. GET  /admin/impersonate — list active + recent sessions (admin
//      + superadmin).
//
// Invariants:
//   - Only superadmin or admin roles may start a session. A clinician
//     cannot self-impersonate.
//   - Reason is required (free text, stored for audit).
//   - Cannot impersonate across clinics — admin.clinic_id must match
//     target.clinic_id.
//   - Cannot impersonate another superadmin (prevents privilege
//     laundering).
//   - TTL hardcoded at 15 min; not tuneable per-session.

import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { db, dbAdmin } from '../../db/db';
import { config } from '../../config';
import { HttpError } from '../../shared/errors';
import { writeAuditLog } from '../../utils/audit';

const IMPERSONATION_TTL_MINUTES = 15;

const StartImpersonationSchema = z.object({
  reason: z.string().min(10).max(500),
});

const router = Router();
router.use(authMiddleware);

// POST /admin/impersonate/:staffId — start an impersonation session.
router.post('/:staffId',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { reason } = StartImpersonationSchema.parse(req.body);
      const targetStaffId = req.params.staffId;

      const target = await dbAdmin('staff')
        .where({ id: targetStaffId, clinic_id: req.clinicId, deleted_at: null })
        .first();
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'Target staff member not found');

      if (target.id === req.user!.id) {
        throw new HttpError(400, 'SELF_IMPERSONATION', 'Cannot impersonate yourself');
      }
      if (target.role === 'superadmin') {
        throw new HttpError(403, 'FORBIDDEN', 'Cannot impersonate a superadmin');
      }

      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + IMPERSONATION_TTL_MINUTES * 60 * 1000);

      const [session] = await db('admin_impersonation_sessions')
        .insert({
          clinic_id: req.clinicId,
          admin_id: req.user!.id,
          impersonated_staff_id: target.id,
          reason,
          started_at: startedAt,
          expires_at: expiresAt,
        })
        .returning(['id', 'admin_id', 'impersonated_staff_id', 'started_at', 'expires_at']);

      const tokenPayload = {
        id: target.id,
        clinicId: target.clinic_id,
        role: target.role,
        permissions: [],
        givenName: target.given_name,
        familyName: target.family_name,
        email: target.email,
        impersonator: req.user!.id,
        impersonationSessionId: session.id,
      };
      const token = jwt.sign(tokenPayload, config.jwt.accessSecret, {
        expiresIn: `${IMPERSONATION_TTL_MINUTES}m`,
      });

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'ACCESS',
        tableName: 'admin_impersonation_sessions',
        recordId: session.id,
        newData: {
          event: 'IMPERSONATION_START',
          adminId: req.user!.id,
          impersonatedStaffId: target.id,
          reason,
        },
      });

      res.status(201).json({
        sessionId: session.id,
        token,
        expiresAt,
        impersonatedStaff: {
          id: target.id,
          givenName: target.given_name,
          familyName: target.family_name,
          role: target.role,
        },
      });
    } catch (err) { next(err); }
  },
);

// POST /admin/impersonate/:id/end — end an active session early.
router.post('/:id/end',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await db('admin_impersonation_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .first();
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

      if (existing.ended_at) {
        res.status(409).json({ error: 'Session already ended' });
        return;
      }

      const [row] = await db('admin_impersonation_sessions')
        .where({ id: req.params.id, clinic_id: req.clinicId })
        .update({ ended_at: new Date() })
        .returning(['id', 'admin_id', 'impersonated_staff_id', 'started_at', 'expires_at', 'ended_at']);

      await writeAuditLog({
        clinicId: req.clinicId!,
        actorId: req.user!.id,
        action: 'ACCESS',
        tableName: 'admin_impersonation_sessions',
        recordId: row.id,
        newData: { event: 'IMPERSONATION_END', endedBy: req.user!.id },
      });

      res.json(row);
    } catch (err) { next(err); }
  },
);

// GET /admin/impersonate — list active + recent sessions.
router.get('/',
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const active = req.query.active === 'true';
      let q = db('admin_impersonation_sessions')
        .where({ clinic_id: req.clinicId })
        .select(
          'id', 'admin_id as adminId', 'impersonated_staff_id as impersonatedStaffId',
          'reason', 'started_at as startedAt', 'expires_at as expiresAt',
          'ended_at as endedAt', 'created_at as createdAt',
        )
        .orderBy('started_at', 'desc')
        .limit(100);

      if (active) {
        q = q.whereNull('ended_at').andWhere('expires_at', '>', new Date());
      }

      const rows = await q;
      res.json({ sessions: rows });
    } catch (err) { next(err); }
  },
);

export default router;
