import { randomBytes } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
// @jsonb-extraction-exempt: BUG-WF22-PWD-RESET-MISSING auth routes return ack/session payloads only; staff JSONB extraction is owned by staff mappers.
import {
  loginController,
  logoutController,
  refreshController,
  mfaVerifyController,
  meController,
  validateLogin,
  validateMfaVerify,
} from './authController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { asyncHandler } from '../../shared/utils/asyncHandler';
import { AuthService } from './authService';

import { config } from '../../config';
import { db } from '../../db/db';
import { addJob } from '../../queues';
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { withTenantContext } from '../../shared/tenantContext';
import { assertPasswordNotBreached } from './passwordBreachService';
import { effectiveIdleMinutesForClinic, primeIdleWindow } from '../../middleware/sessionIdleMiddleware';
import bcrypt from 'bcryptjs';
import { StaffRepository } from '../staff/staffRepository';
import { AppError } from '../../shared/errors';
import { requireRole } from '../../middleware/rbacMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import { requireIdempotencyKey } from '../../middleware/requireIdempotencyKey';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { requireAccessSettingsAuthority } from '../../shared/authGuards';
import { redis } from '../../config/redis';
import {
  buildApiLimiterKey,
  buildAuthLimiterKey,
  buildLlmLimiterKey,
  buildPatientActivateCodeLimiterKey,
  buildPatientAuthLimiterKey,
  buildPatientLoginPhoneLimiterKey,
  buildUploadLimiterKey,
  buildWebhookLimiterKey,
} from '../../middleware/rateLimiters';

export const authRouter = Router();
const staffRepository = new StaffRepository();
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const passwordResetRequestAckToResponse = () => ({
  ok: true,
  message: 'If that address is registered, a reset link has been sent.',
});

function extractClinicHintFromResetToken(token: string): string | null {
  const [maybeClinicId] = token.split('.', 1);
  if (maybeClinicId && UUID_RX.test(maybeClinicId)) {
    return maybeClinicId;
  }
  return null;
}

const PasswordResetRequestSchema = z.object({
  email: z.string().email(),
});

const PasswordResetConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z
    .string()
    .min(12)
    .regex(/[A-Z]/)
    .regex(/[a-z]/)
    .regex(/[0-9]/)
    .regex(/[^A-Za-z0-9]/),
  confirmPassword: z.string(),
}).superRefine((dto, ctx) => {
  if (dto.newPassword !== dto.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmPassword'],
      message: 'Passwords do not match',
    });
  }
});

const AuthLimiterRouteSchema = z.enum([
  '/api/v1/auth/mfa',
  '/api/v1/auth/refresh',
  '/api/v1/auth/change-password',
  '/api/v1/auth/verify-mfa-challenge',
  '/api/v1/auth/verify-password-challenge',
  '/api/v1/auth/break-glass',
  '/api/v1/auth/webauthn/login',
  '/api/v1/auth/webauthn/register',
  '/api/v1/admin/impersonate',
]);

const NonWildcardTokenSchema = z.string().trim().min(1).max(160).refine(
  (value) => !/[*?]/.test(value),
  'Wildcard token is not permitted',
);

const AccessControlLimiterTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('auth_login'),
    ip: NonWildcardTokenSchema,
    email: z.string().email(),
  }),
  z.object({
    kind: z.literal('auth_route'),
    ip: NonWildcardTokenSchema,
    route: AuthLimiterRouteSchema,
  }),
  z.object({
    kind: z.literal('api_ip'),
    ip: NonWildcardTokenSchema,
  }),
  z.object({
    kind: z.literal('patient_auth_ip'),
    ip: NonWildcardTokenSchema,
  }),
  z.object({
    kind: z.literal('patient_login_phone'),
    phone: NonWildcardTokenSchema,
  }),
  z.object({
    kind: z.literal('patient_activate_code'),
    code: NonWildcardTokenSchema,
  }),
  z.object({
    kind: z.literal('upload_ip'),
    ip: NonWildcardTokenSchema,
  }),
  z.object({
    kind: z.literal('webhook_ip'),
    ip: NonWildcardTokenSchema,
  }),
  z.object({
    kind: z.literal('llm_ip'),
    ip: NonWildcardTokenSchema,
  }),
]);

const AccessControlUnlockTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('staff_account'),
    staffId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('patient_app_account'),
    accountId: z.string().uuid(),
  }),
]);

const AdminAccessControlResetSchema = z.object({
  ticketId: z.string().trim().min(3).max(80).regex(/^[A-Za-z0-9._:-]+$/),
  reason: z.string().trim().min(10).max(500),
  limiter: AccessControlLimiterTargetSchema.optional(),
  unlock: AccessControlUnlockTargetSchema.optional(),
}).superRefine((dto, ctx) => {
  if (!dto.limiter && !dto.unlock) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one action is required: limiter reset and/or account unlock',
      path: ['limiter'],
    });
  }
});

const AdminAccessControlResetResponseSchema = z.object({
  ok: z.literal(true),
  ticketId: z.string(),
  limiter: z.object({
    key: z.string(),
    deleted: z.number().int().nonnegative(),
  }).nullable(),
  unlock: z.union([
    z.object({
      kind: z.literal('staff_account'),
      staffId: z.string().uuid(),
    }),
    z.object({
      kind: z.literal('patient_app_account'),
      accountId: z.string().uuid(),
    }),
    z.null(),
  ]),
});

function buildLimiterKeyFromTarget(target: z.infer<typeof AccessControlLimiterTargetSchema>): string {
  switch (target.kind) {
    case 'auth_login':
      return buildAuthLimiterKey({
        ip: target.ip,
        route: '/api/v1/auth/login',
        email: target.email,
      });
    case 'auth_route':
      return buildAuthLimiterKey({
        ip: target.ip,
        route: target.route,
        email: undefined,
      });
    case 'api_ip':
      return buildApiLimiterKey(target.ip);
    case 'patient_auth_ip':
      return buildPatientAuthLimiterKey(target.ip);
    case 'patient_login_phone':
      return buildPatientLoginPhoneLimiterKey(target.phone);
    case 'patient_activate_code':
      return buildPatientActivateCodeLimiterKey(target.code, undefined);
    case 'upload_ip':
      return buildUploadLimiterKey(target.ip);
    case 'webhook_ip':
      return buildWebhookLimiterKey(target.ip);
    case 'llm_ip':
      return buildLlmLimiterKey(target.ip);
  }
}

// CSRF token endpoint — Synchronizer Token Pattern (Phase 0.7.1).
// Token stored in Redis with CSRF_TOKEN_TTL_SECONDS so csrfMiddleware
// can validate the value, not just the header's presence. TTL constant
// imported from shared/csrfConfig so the issuer here and the sliding
// refresh in middleware/csrfMiddleware.ts stay in lockstep (USER-A.2
// absorb-1 — L5 "SSOT" architectural standard).
authRouter.get('/csrf', async (_req, res, next) => {
  try {
    const crypto = await import('crypto');
    const { redis } = await import('../../config/redis');
    const { CSRF_TOKEN_TTL_SECONDS } = await import('../../shared/csrfConfig');
    const token = crypto.randomBytes(32).toString('hex');
    await redis.set(`csrf:${token}`, '1', 'EX', CSRF_TOKEN_TTL_SECONDS);
    res.json({ csrfToken: token });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', validateLogin, asyncHandler(loginController));
authRouter.post('/mfa/verify', validateMfaVerify, asyncHandler(mfaVerifyController));
authRouter.post('/refresh', asyncHandler(refreshController));
authRouter.post('/logout', asyncHandler(logoutController));
authRouter.get('/me', authMiddleware, asyncHandler(meController));

authRouter.post(
  '/admin/access-control/reset',
  authMiddleware,
  requireRole('admin', 'superadmin'),
  requireIdempotencyKey,
  idempotencyMiddleware(),
  asyncHandler(async (req, res) => {
    const auth = buildAuthContext(req);
    await requireAccessSettingsAuthority(auth, req.clinicId);

    const dto = AdminAccessControlResetSchema.parse(req.body);
    const requestIp = String((req.headers['x-forwarded-for'] as string) ?? req.ip ?? '').slice(0, 120);

    let limiterKey: string | null = null;
    let limiterDeleted = 0;
    if (dto.limiter) {
      limiterKey = buildLimiterKeyFromTarget(dto.limiter);
      limiterDeleted = Number(await redis.del(limiterKey));
    }

    let unlockResult:
      | { kind: 'staff_account'; staffId: string }
      | { kind: 'patient_app_account'; accountId: string }
      | null = null;
    if (dto.unlock?.kind === 'staff_account') {
      const updated = await db('staff')
        .where({ id: dto.unlock.staffId, clinic_id: req.clinicId })
        .whereNull('deleted_at')
        .update({
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date(),
        });
      if (updated === 0) {
        throw new AppError('Staff account not found in this clinic', 404, 'NOT_FOUND');
      }
      unlockResult = {
        kind: 'staff_account',
        staffId: dto.unlock.staffId,
      };
    } else if (dto.unlock?.kind === 'patient_app_account') {
      const updated = await db('patient_app_accounts')
        .where({ id: dto.unlock.accountId, clinic_id: req.clinicId })
        .update({
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date(),
        });
      if (updated === 0) {
        throw new AppError('Patient app account not found in this clinic', 404, 'NOT_FOUND');
      }
      unlockResult = {
        kind: 'patient_app_account',
        accountId: dto.unlock.accountId,
      };
    }

    await writeAuditLog({
      clinicId: req.clinicId,
      actorId: req.user?.id ?? auth.staffId,
      action: 'UPDATE',
      tableName: 'auth_access_controls',
      recordId: unlockResult?.kind === 'staff_account'
        ? unlockResult.staffId
        : unlockResult?.kind === 'patient_app_account'
          ? unlockResult.accountId
          : (limiterKey ?? 'auth-access-control-reset'),
      ipAddress: requestIp || undefined,
      newData: {
        event: 'targeted_limiter_reset_account_unlock',
        ticketId: dto.ticketId,
        reason: dto.reason,
        limiter: limiterKey
          ? { target: dto.limiter, key: limiterKey, deleted: limiterDeleted }
          : null,
        unlock: unlockResult,
      },
    });

    logger.info(
      {
        kind: 'security_targeted_limiter_reset_unlock',
        clinicId: req.clinicId,
        actorId: req.user?.id ?? auth.staffId,
        ticketId: dto.ticketId,
        limiterKey,
        limiterDeleted,
        unlock: unlockResult,
      },
      'Admin executed targeted limiter reset/account unlock',
    );

    res.status(200).json(
      AdminAccessControlResetResponseSchema.parse({
        ok: true,
        ticketId: dto.ticketId,
        limiter: limiterKey
          ? { key: limiterKey, deleted: limiterDeleted }
          : null,
        unlock: unlockResult,
      }),
    );
  }),
);

// ── Password Reset (request + confirm) ────────────────────────────────────
authRouter.post('/password-reset/request', asyncHandler(async (req, res) => {
  const dto = PasswordResetRequestSchema.parse(req.body);
  const staff = await staffRepository.findByEmail(dto.email);

  // Return generic 200 regardless of account existence.
  if (!staff?.id || !staff.clinic_id) {
    res.status(200).json(passwordResetRequestAckToResponse());
    return;
  }

  // Prefix clinic UUID so unauthenticated confirm flow can resolve tenant
  // context under FORCE RLS without any owner-role bypass.
  const rawToken = `${staff.clinic_id}.${randomBytes(32).toString('hex')}`;
  const tokenHash = (await import('crypto')).createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const requestedIp = String((req.headers['x-forwarded-for'] as string) ?? req.ip ?? '').slice(0, 120);
  const requestedUserAgent = String(req.headers['user-agent'] ?? '').slice(0, 255);

  await withTenantContext(staff.clinic_id, async () => {
    await db('password_reset_tokens')
      .where({ staff_id: staff.id })
      .whereNull('used_at')
      .update({ used_at: new Date() });

    await db('password_reset_tokens').insert({
      clinic_id: staff.clinic_id,
      staff_id: staff.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      requested_ip: requestedIp || null,
      requested_user_agent: requestedUserAgent || null,
      created_at: new Date(),
    });
  }, staff.id);

  const resetUrl = `${config.CORS_ORIGIN.replace(/\/$/, '')}/forgot-password?token=${encodeURIComponent(rawToken)}`;

  try {
    await addJob('email', {
      type: 'staff_notification',
      clinicId: staff.clinic_id,
      staffId: staff.id,
      title: 'Password reset request',
      body: `A password reset was requested for your account. Use this link to set a new password: ${resetUrl}`,
      category: 'security',
      severity: 'warning',
      actionUrl: resetUrl,
    });
  } catch (err) {
    logger.warn({ err, staffId: staff.id, clinicId: staff.clinic_id }, 'password-reset request email enqueue failed');
  }

  await writeAuditLog({
    clinicId: staff.clinic_id,
    actorId: staff.id,
    action: 'PASSWORD_RESET_REQUEST',
    tableName: 'password_reset_tokens',
    recordId: staff.id,
    ipAddress: requestedIp || undefined,
    newData: { email: staff.email },
  });

  res.status(200).json(passwordResetRequestAckToResponse());
}));

authRouter.post('/password-reset/confirm', asyncHandler(async (req, res) => {
  const dto = PasswordResetConfirmSchema.parse(req.body);
  const tokenHash = (await import('crypto')).createHash('sha256').update(dto.token).digest('hex');
  const clinicIdHint = extractClinicHintFromResetToken(dto.token);
  if (!clinicIdHint) {
    throw new AppError(
      'Password reset token is invalid or expired',
      400,
      'INVALID_OR_EXPIRED_TOKEN',
    );
  }

  const tokenRow = await withTenantContext(clinicIdHint, async () => {
    const row = await db('password_reset_tokens as prt')
      .join('staff as s', 's.id', 'prt.staff_id')
      .where('prt.token_hash', tokenHash)
      .whereNull('prt.used_at')
      .where('prt.expires_at', '>', new Date())
      .whereNull('s.deleted_at')
      .first('prt.id', 'prt.staff_id', 'prt.clinic_id');
    return row ?? null;
  });

  if (!tokenRow?.staff_id || !tokenRow.clinic_id) {
    throw new AppError(
      'Password reset token is invalid or expired',
      400,
      'INVALID_OR_EXPIRED_TOKEN',
    );
  }

  await assertPasswordNotBreached(
    {
      clinicId: String(tokenRow.clinic_id),
      staffId: String(tokenRow.staff_id),
      role: 'clinician',
      permissions: [],
    },
    dto.newPassword,
    { surface: 'password_reset_confirm' },
  );

  const passwordHash = await bcrypt.hash(dto.newPassword, 10);

  const authService = new AuthService();
  await withTenantContext(String(tokenRow.clinic_id), async () => {
    await db('staff')
      .where({ id: tokenRow.staff_id, clinic_id: tokenRow.clinic_id })
      .update({
        password_hash: passwordHash,
        must_change_password: false,
        updated_at: new Date(),
      });

    await db('password_reset_tokens')
      .where({ staff_id: tokenRow.staff_id })
      .whereNull('used_at')
      .update({ used_at: new Date() });

    await authService.revokeSessionsForStaff(String(tokenRow.staff_id));
    await writeAuditLog({
      clinicId: String(tokenRow.clinic_id),
      actorId: String(tokenRow.staff_id),
      action: 'PASSWORD_RESET_CONFIRM',
      tableName: 'staff',
      recordId: String(tokenRow.staff_id),
      newData: { source: 'self_service_password_reset' },
    });
  }, String(tokenRow.staff_id));

  res.status(200).json({ ok: true });
}));

// ── HIPAA: Password Change ──
authRouter.post('/change-password', authMiddleware, asyncHandler(async (req, res) => {
  const { ChangePasswordResponseSchema, ChangePasswordSchema } = await import('@signacare/shared');
  const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);

  const authService = new AuthService();
  const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? undefined;
  const userAgent = req.headers['user-agent'];

  const result = await authService.changePassword(
    req.user!.id,
    req.user!.clinicId,
    currentPassword,
    newPassword,
    { ipAddress: ip, userAgent },
  );

  const isProd = process.env.NODE_ENV === 'production';
  const cookieOpts = {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'strict' : 'lax') as 'strict' | 'lax',
    path: '/',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
  res.cookie('signacare_access', result.accessToken, {
    ...cookieOpts,
    maxAge: config.jwt.accessTtlMinutes * 60 * 1000,
  });
  res.cookie('signacare_refresh', result.refreshToken, {
    ...cookieOpts,
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });

  effectiveIdleMinutesForClinic(result.user.clinicId)
    .then((minutes) => primeIdleWindow(result.user.id, minutes))
    .catch((err: unknown) => {
      logger.warn(
        { err, staffId: result.user.id, clinicId: result.user.clinicId, op: 'prime' },
        'sessionIdleMiddleware.primeIdleWindow failed after password change',
      );
  });

  const isMobile = req.headers['x-client'] === 'mobile';
  res.status(200).json(ChangePasswordResponseSchema.parse({
    success: true,
    message: 'Password changed successfully.',
    user: result.user,
    ...(isMobile && {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    }),
  }));
}));

// ── MFA Setup (TOTP) ──
authRouter.post('/mfa/setup', authMiddleware, asyncHandler(async (req, res) => {
  const speakeasy = (await import('speakeasy')).default;
  const { staffRepository } = await import('../staff/staffRepository');

  const staffId = req.user!.id;
  const staff = await staffRepository.findById(staffId);
  if (!staff) { res.status(404).json({ error: 'Staff not found' }); return; }

  const secret = speakeasy.generateSecret({
    name: `${config.mfa.issuer} (${staff.email})`,
    issuer: config.mfa.issuer,
    length: 20,
  });

  // Store the secret on the staff record (pending confirmation)
  await staffRepository.setMfaSecret(staffId, secret.base32);

  // Generate recovery codes — 10 codes, 40-bit entropy each (industry standard)
  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(5).toString('hex').toUpperCase()
  );
  await staffRepository.setRecoveryCodes(staffId, recoveryCodes);

  res.json({
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
    qrDataUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(secret.otpauth_url!)}`,
    recoveryCodes,
  });
}));

authRouter.post('/mfa/confirm', authMiddleware, asyncHandler(async (req, res) => {
  const speakeasy = (await import('speakeasy')).default;
  const { staffRepository } = await import('../staff/staffRepository');

  const staffId = req.user!.id;
  const staff = await staffRepository.findById(staffId);
  if (!staff?.mfa_secret) { res.status(400).json({ error: 'No MFA secret found. Start setup first.' }); return; }

  const { MfaConfirmSchema } = await import('@signacare/shared');
  const { token: mfaToken } = MfaConfirmSchema.parse(req.body);
  const isValid = speakeasy.totp.verify({ secret: staff.mfa_secret, encoding: 'base32', token: mfaToken, window: 1 });
  if (!isValid) { res.status(400).json({ error: 'Invalid code. Please try again.' }); return; }

  await staffRepository.enableMfa(staffId);
  res.json({ ok: true, message: 'MFA enabled successfully.' });
}));

authRouter.post('/mfa/disable', authMiddleware, asyncHandler(async (req, res) => {
  const { staffRepository } = await import('../staff/staffRepository');
  await staffRepository.disableMfa(req.user!.id);
  res.json({ ok: true, message: 'MFA disabled.' });
}));

authRouter.get('/mfa/status', authMiddleware, asyncHandler(async (req, res) => {
  const { staffRepository } = await import('../staff/staffRepository');
  const staff = await staffRepository.findById(req.user!.id);
  res.json({ enabled: !!staff?.mfa_enabled, configured: !!staff?.mfa_secret });
}));

// MFA challenge verification — for sensitive actions (signing, prescribing)
// BUG-P3 — successful verification marks the step-up window so subsequent
// S8 prescribing mutations within STEP_UP_TTL_MINUTES (default 5) bypass
// the AppError(403, 'STEP_UP_REQUIRED') gate. PRES-7 DH-3869 + DH-4155 §3.
authRouter.post('/verify-mfa-challenge', authMiddleware, asyncHandler(async (req, res) => {
  const { VerifyMfaChallengeSchema } = await import('@signacare/shared');
  const { code } = VerifyMfaChallengeSchema.parse(req.body);
  const { staffRepository } = await import('../staff/staffRepository');
  const staff = await staffRepository.findById(req.user!.id);
  if (!staff?.mfa_secret) { res.status(400).json({ error: 'MFA not configured', verified: false }); return; }
  const speakeasy = (await import('speakeasy')).default;
  const valid = speakeasy.totp.verify({ secret: staff.mfa_secret, encoding: 'base32', token: code, window: 1 });
  if (!valid) { res.status(401).json({ error: 'Invalid MFA code', verified: false }); return; }
  const { markStepUpVerified } = await import('../../shared/stepUpAuth');
  await markStepUpVerified(req.user!.id);
  res.json({ verified: true });
}));

// Password challenge verification — fallback for users without MFA
// BUG-P3 — same step-up marking as the MFA path.
authRouter.post('/verify-password-challenge', authMiddleware, asyncHandler(async (req, res) => {
  const { VerifyPasswordChallengeSchema } = await import('@signacare/shared');
  const { password } = VerifyPasswordChallengeSchema.parse(req.body);
  const { staffRepository } = await import('../staff/staffRepository');
  const staff = await staffRepository.findById(req.user!.id);
  if (!staff) { res.status(404).json({ error: 'Staff not found', verified: false }); return; }
  const bcrypt = await import('bcryptjs');
  const valid = await bcrypt.compare(password, staff.password_hash);
  if (!valid) { res.status(401).json({ error: 'Incorrect password', verified: false }); return; }
  const { markStepUpVerified } = await import('../../shared/stepUpAuth');
  await markStepUpVerified(req.user!.id);
  res.json({ verified: true });
}));

export default authRouter;
