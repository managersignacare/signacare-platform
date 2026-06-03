// apps/api/src/features/auth/breakGlassRoutes.ts
//
// Emergency break-glass access.
//
// GAP-04 closure (S6.1, 2026-04-11) — now enforces the full HIPAA 164.312(a)(2)(ii)
// and NSQHS Std 1 workflow:
//
//   1. POST /auth/break-glass/request          — staff submits credential-verified
//                                                 request with reason (>= 10 chars);
//                                                 row inserted in break_glass_sessions
//                                                 with status='pending'.
//   2. POST /auth/break-glass/:id/approve      — second staff member (admin or
//                                                 superadmin, != requester) approves
//                                                 the request; time-limited JWT is
//                                                 minted with `breakGlass: true` and
//                                                 its SHA-256 hash stored on the row.
//                                                 Slack alert dispatched (dry-run in
//                                                 dev / staging unless wired).
//   3. POST /auth/break-glass/:id/deny         — approver denies (reason captured).
//   4. POST /auth/break-glass/:id/revoke       — admin revokes an active session early.
//   5. GET  /auth/break-glass                  — admin list of recent sessions
//                                                 (pending → approved → expired).
//   6. GET  /auth/break-glass/active           — active sessions (for banner / UI).
//
// A companion middleware in ../../middleware/breakGlassAuditMiddleware.ts tags every
// request carrying a break-glass JWT so every downstream audit_log row is linked
// back to the originating break_glass_sessions row.
//
// Non-bypassable invariants:
//   - RLS still applies; break-glass does NOT grant cross-tenant access.
//   - Two-person rule: the requester cannot approve their own session (DB
//     CHECK-less because we enforce it in the handler; CHECK would require
//     a trigger because approver_id is nullable until approval).
//   - Uniqueness: a staff member may have at most one 'pending' session at a
//     time (partial unique index from the migration).
//   - Time-limited: issued token lifetime = BREAK_GLASS_TTL_MINUTES (default 30).
//
// Standards satisfied: HIPAA 164.312(a)(2)(ii), NSQHS Std 1, ISO 27001 A.8.3,
//                      OWASP ASVS V2.2.
//
// Fix Registry: BG1 through BG6 (see docs/fix-registry.md).

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { createHash } from 'crypto';
import { db, dbAdmin } from '../../db/db';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { HttpError } from '../../shared/errors';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { effectiveIdleMinutesForClinic, primeIdleWindow } from '../../middleware/sessionIdleMiddleware';

// ── Local Zod schemas (Phase R3b / CLAUDE.md §12) ────────────────────────────
// Break-glass is security-critical: reason is min-length-gated here at the
// request boundary rather than at service layer, so malformed payloads never
// reach downstream code.
const BreakGlassRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfaCode: z.string().optional(),
  reason: z.string()
    .trim()
    .min(10, 'Reason must be at least 10 characters describing the emergency')
    .max(2000),
});

const BreakGlassDenySchema = z.object({
  deniedReason: z.string().trim().min(5, 'deniedReason (>= 5 chars) is required').max(1000),
});

const router = Router();

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified: break_glass_sessions has these 18 columns (NO updated_at —
// session is APPEND-ONLY; status transitions write to dedicated
// approved_at/revoked_at/expires_at columns).
const BREAK_GLASS_SESSION_COLUMNS = [
  'id', 'clinic_id', 'staff_id', 'reason', 'status', 'approver_id',
  'approved_at', 'denied_reason', 'token_hash', 'issued_at',
  'expires_at', 'revoked_at', 'revoked_by', 'ip_address', 'user_agent',
  'actions_performed', 'alerted_at', 'created_at',
] as const;

const BREAK_GLASS_TTL_MINUTES = Number(process.env.BREAK_GLASS_TTL_MINUTES ?? 30);

const BREAK_GLASS_PERMISSIONS = [
  'patient:read',
  'patient:update',
  'note:read',
  'note:create',
  'medication:read',
];

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Side-effect-free alert dispatch — logs on failure rather than throwing so a
 * broken Slack webhook never blocks an emergency. In dev/staging the env var
 * is unset and we only log. In production the webhook URL is injected via the
 * secrets resolver.
 */
async function dispatchSecurityAlert(payload: {
  event: 'break-glass-requested' | 'break-glass-approved' | 'break-glass-denied' | 'break-glass-revoked';
  sessionId: string;
  staffId: string;
  clinicId: string;
  reason?: string;
  approverId?: string;
  ip?: string;
}): Promise<void> {
  const webhook = process.env.SLACK_WEBHOOK_SECURITY;
  if (!webhook) {
    logger.warn({ ...payload }, '[dry-run] break-glass security alert');
    return;
  }
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:rotating_light: BREAK-GLASS ${payload.event.toUpperCase()}`,
        attachments: [
          {
            color: 'danger',
            fields: [
              { title: 'Session', value: payload.sessionId, short: true },
              { title: 'Staff', value: payload.staffId, short: true },
              { title: 'Clinic', value: payload.clinicId, short: true },
              { title: 'IP', value: payload.ip ?? 'unknown', short: true },
              ...(payload.approverId ? [{ title: 'Approver', value: payload.approverId, short: true }] : []),
              ...(payload.reason ? [{ title: 'Reason', value: payload.reason, short: false }] : []),
            ],
          },
        ],
      }),
    });
  } catch (err) {
    logger.error({ err, ...payload }, 'Failed to dispatch break-glass Slack alert');
  }
}

// ── 1. Request break-glass access ────────────────────────────────────────────
router.post('/break-glass/request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, mfaCode, reason } = BreakGlassRequestSchema.parse(req.body);

    const staff = await dbAdmin('staff')
      .where({ email: String(email).toLowerCase(), deleted_at: null, is_active: true })
      .first();
    if (!staff) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

    const passwordMatch = await bcrypt.compare(password, staff.password_hash);
    if (!passwordMatch) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');

    if (staff.mfa_enabled) {
      if (!mfaCode) throw new HttpError(400, 'MFA_REQUIRED', 'MFA code required for break-glass access');
      const mfaSecret = await dbAdmin('mfa_secrets')
        .where({ staff_id: staff.id, is_active: true })
        .first();
      if (mfaSecret) {
        const valid = speakeasy.totp.verify({
          secret: mfaSecret.secret,
          encoding: 'base32',
          token: String(mfaCode),
          window: 2,
        });
        if (!valid) throw new HttpError(401, 'INVALID_MFA', 'Invalid MFA code');
      }
    }

    // §1.6 — INSERT on RLS-protected table includes clinic_id.
    // Unique partial index (break_glass_sessions_one_pending_per_staff)
    // enforces at-most-one pending request per staff.
    let session;
    try {
      [session] = await dbAdmin('break_glass_sessions')
        .insert({
          clinic_id: staff.clinic_id,
          staff_id: staff.id,
          reason,
          status: 'pending',
          ip_address: req.ip ?? null,
          user_agent: req.headers['user-agent'] ?? null,
        })
        .returning(BREAK_GLASS_SESSION_COLUMNS);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        throw new HttpError(
          409,
          'BREAK_GLASS_PENDING',
          'You already have a pending break-glass request. Ask an admin to approve or cancel it first.',
        );
      }
      throw err;
    }

    // BUG-467 — migrated to typed writeAuditLog.
    {
      const { writeAuditLog } = await import('../../utils/audit');
      await writeAuditLog({
        clinicId: staff.clinic_id,
        actorId: staff.id,
        tableName: 'break_glass_sessions',
        recordId: session.id,
        action: 'BREAK_GLASS_REQUESTED',
        newData: {
          reason,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });
    }

    await dispatchSecurityAlert({
      event: 'break-glass-requested',
      sessionId: session.id,
      staffId: staff.id,
      clinicId: staff.clinic_id,
      reason,
      ip: req.ip,
    });
    await dbAdmin('break_glass_sessions').where({ id: session.id }).update({ alerted_at: new Date() });

    logger.warn(
      { sessionId: session.id, staffId: staff.id, clinicId: staff.clinic_id, reason },
      'BREAK-GLASS REQUESTED',
    );

    res.status(201).json({
      sessionId: session.id,
      status: 'pending',
      message:
        'Break-glass request submitted. An admin or superadmin must approve it before you receive elevated access.',
    });
  } catch (err) {
    next(err);
  }
});

// ── 2. Approve a pending request ─────────────────────────────────────────────
router.post(
  '/break-glass/:id/approve',
  authMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const approverId = req.user!.id;
      const clinicId = req.clinicId;

      const session = await db('break_glass_sessions')
        .where({ id: req.params.id, clinic_id: clinicId })
        .first();
      if (!session) throw new HttpError(404, 'NOT_FOUND', 'Break-glass session not found');
      if (session.status !== 'pending') {
        throw new HttpError(409, 'INVALID_STATE', `Session is ${session.status}, cannot approve`);
      }

      // Two-person rule — requester cannot self-approve.
      if (session.staff_id === approverId) {
        throw new HttpError(403, 'SELF_APPROVAL', 'You cannot approve your own break-glass request');
      }

      // Load the requester so we can mint a JWT with THEIR identity.
      const requester = await dbAdmin('staff')
        .where({ id: session.staff_id, clinic_id: clinicId, deleted_at: null, is_active: true })
        .first();
      if (!requester) {
        await db('break_glass_sessions')
          .where({ id: session.id, clinic_id: clinicId })
          .update({
            status: 'denied',
            approver_id: approverId,
            denied_reason: 'Requesting staff account inactive at approval time',
          });

        const { writeAuditLog } = await import('../../utils/audit');
        await writeAuditLog({
          clinicId,
          actorId: approverId,
          tableName: 'break_glass_sessions',
          recordId: session.id,
          action: 'BREAK_GLASS_DENIED',
          newData: {
            requesterId: session.staff_id,
            deniedReason: 'Requesting staff account inactive at approval time',
            denialType: 'inactive_or_deleted_requester',
          },
        });

        throw new HttpError(
          409,
          'REQUESTER_INACTIVE',
          'Requesting staff member is inactive; session was auto-denied',
        );
      }

      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + BREAK_GLASS_TTL_MINUTES * 60 * 1000);

      const tokenPayload = {
        id: requester.id,
        clinicId: requester.clinic_id,
        role: requester.role,
        permissions: BREAK_GLASS_PERMISSIONS,
        givenName: requester.given_name,
        familyName: requester.family_name,
        email: requester.email,
        breakGlass: true,
        breakGlassSessionId: session.id,
      };
      const breakGlassToken = jwt.sign(tokenPayload, config.jwt.accessSecret, {
        expiresIn: `${BREAK_GLASS_TTL_MINUTES}m`,
      });

      // Store only the hash — never the raw token.
      const tokenHash = sha256Hex(breakGlassToken);

      await db('break_glass_sessions')
        .where({ id: session.id, clinic_id: clinicId })
        .update({
          status: 'approved',
          approver_id: approverId,
          approved_at: issuedAt,
          token_hash: tokenHash,
          issued_at: issuedAt,
          expires_at: expiresAt,
        });

      // BUG-467 — migrated to typed writeAuditLog.
      {
        const { writeAuditLog } = await import('../../utils/audit');
        await writeAuditLog({
          clinicId,
          actorId: approverId,
          tableName: 'break_glass_sessions',
          recordId: session.id,
          action: 'BREAK_GLASS_APPROVED',
          newData: {
            requesterId: requester.id,
            expiresAt: expiresAt.toISOString(),
            ttlMinutes: BREAK_GLASS_TTL_MINUTES,
          },
        });
      }

      await dispatchSecurityAlert({
        event: 'break-glass-approved',
        sessionId: session.id,
        staffId: requester.id,
        clinicId,
        approverId,
      });

      logger.warn(
        { sessionId: session.id, staffId: requester.id, clinicId, approverId },
        'BREAK-GLASS APPROVED — elevated token issued',
      );

      // Prime the Redis idle sliding-window for break-glass sessions so the
      // minted token does not fail immediately with SESSION_EXPIRED before
      // break-glass governance middleware can enforce its own invariants.
      // Mirrors login path behavior (fail-open with operator-visible warning).
      effectiveIdleMinutesForClinic(requester.clinic_id)
        .then((minutes) => primeIdleWindow(requester.id, minutes))
        .catch((err) => {
          logger.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              staffId: requester.id,
              clinicId,
            },
            'breakGlassRoutes.approve: failed to prime idle window for break-glass token',
          );
        });

      res.json({
        sessionId: session.id,
        token: breakGlassToken,
        expiresAt: expiresAt.toISOString(),
        expiresIn: BREAK_GLASS_TTL_MINUTES * 60,
        message: `Emergency access granted. Token expires in ${BREAK_GLASS_TTL_MINUTES} minutes. Every action is audited.`,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── 3. Deny a pending request ────────────────────────────────────────────────
router.post(
  '/break-glass/:id/deny',
  authMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const approverId = req.user!.id;
      const clinicId = req.clinicId;
      const { deniedReason } = BreakGlassDenySchema.parse(req.body);

      const session = await db('break_glass_sessions')
        .where({ id: req.params.id, clinic_id: clinicId })
        .first();
      if (!session) throw new HttpError(404, 'NOT_FOUND', 'Break-glass session not found');
      if (session.status !== 'pending') {
        throw new HttpError(409, 'INVALID_STATE', `Session is ${session.status}, cannot deny`);
      }
      if (session.staff_id === approverId) {
        throw new HttpError(403, 'SELF_APPROVAL', 'You cannot deny your own break-glass request');
      }

      await db('break_glass_sessions')
        .where({ id: session.id, clinic_id: clinicId })
        .update({
          status: 'denied',
          approver_id: approverId,
          denied_reason: deniedReason.trim(),
        });

      // BUG-467 — migrated to typed writeAuditLog.
      {
        const { writeAuditLog } = await import('../../utils/audit');
        await writeAuditLog({
          clinicId,
          actorId: approverId,
          tableName: 'break_glass_sessions',
          recordId: session.id,
          action: 'BREAK_GLASS_DENIED',
          newData: { deniedReason: deniedReason.trim() },
        });
      }

      await dispatchSecurityAlert({
        event: 'break-glass-denied',
        sessionId: session.id,
        staffId: session.staff_id,
        clinicId,
        approverId,
      });

      res.json({ sessionId: session.id, status: 'denied' });
    } catch (err) {
      next(err);
    }
  },
);

// ── 4. Revoke an active session ──────────────────────────────────────────────
router.post(
  '/break-glass/:id/revoke',
  authMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const revokerId = req.user!.id;
      const clinicId = req.clinicId;

      const session = await db('break_glass_sessions')
        .where({ id: req.params.id, clinic_id: clinicId })
        .first();
      if (!session) throw new HttpError(404, 'NOT_FOUND', 'Break-glass session not found');
      if (session.status !== 'approved') {
        throw new HttpError(409, 'INVALID_STATE', `Session is ${session.status}, cannot revoke`);
      }

      await db('break_glass_sessions')
        .where({ id: session.id, clinic_id: clinicId })
        .update({
          status: 'revoked',
          revoked_at: new Date(),
          revoked_by: revokerId,
        });

      // BUG-467 — migrated to typed writeAuditLog.
      {
        const { writeAuditLog } = await import('../../utils/audit');
        await writeAuditLog({
          clinicId,
          actorId: revokerId,
          tableName: 'break_glass_sessions',
          recordId: session.id,
          action: 'BREAK_GLASS_REVOKED',
        });
      }

      await dispatchSecurityAlert({
        event: 'break-glass-revoked',
        sessionId: session.id,
        staffId: session.staff_id,
        clinicId,
        approverId: revokerId,
      });

      res.json({ sessionId: session.id, status: 'revoked' });
    } catch (err) {
      next(err);
    }
  },
);

// ── 5. List break-glass sessions (admin view) ────────────────────────────────
router.get(
  '/break-glass',
  authMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinicId = req.clinicId;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const q = db('break_glass_sessions')
        .where({ clinic_id: clinicId })
        .orderBy('created_at', 'desc')
        .limit(200);
      if (status) q.andWhere({ status });
      const sessions = await q;
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  },
);

// ── 6. List active break-glass sessions (for banner UI) ──────────────────────
router.get(
  '/break-glass/active',
  authMiddleware,
  requireRoles(['admin', 'superadmin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinicId = req.clinicId;
      const sessions = await db('break_glass_sessions')
        .where({ clinic_id: clinicId, status: 'approved' })
        .andWhere('expires_at', '>', new Date())
        .orderBy('issued_at', 'desc');
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
