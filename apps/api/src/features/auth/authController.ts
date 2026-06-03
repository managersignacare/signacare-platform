// apps/api/src/controllers/authController.ts
import type { Request, Response } from "express";
import {
  LoginSchema,
  MfaVerifySchema,
  LoginDTO,
  MFAVerifyDTO,
} from "@signacare/shared";
import { AuthService } from './authService';
import { validateBody } from '../../middleware/validationMiddleware';
import { HttpError } from '../../shared/errors';
import { config } from '../../config';
import { primeIdleWindow, clearIdleWindow, effectiveIdleMinutesForClinic } from '../../middleware/sessionIdleMiddleware';
import { logger } from '../../utils/logger';
import { writeAuditLog } from '../../utils/audit';
import { withTiming, type TimingEvent } from '../../shared/observability/withTiming';
import { withTimeout } from '../../shared/observability/withTimeout';

// CLAUDE.md §2.2 — fire-and-forget async calls in request handlers
// must still log their failures. The primeIdleWindow / clearIdleWindow
// calls below are deliberately not awaited (a Redis hiccup must not
// block a successful login or logout), but an unhandled rejection
// becomes invisible without a logger path. This tiny wrapper keeps
// the call sites clean + makes every Redis failure show up at WARN
// level so operators see the idle-store pressure before it cascades.
function logIdleWindowFailure(op: 'prime' | 'clear', staffId: string) {
  return (err: unknown) => {
    logger.warn(
      { err, op, staffId },
      `sessionIdleMiddleware.${op}IdleWindow failed — session idle tracking is degraded`,
    );
  };
}

const authService = new AuthService();
const LOGIN_AUDIT_TIMEOUT_MS_DEFAULT = 2_000;

function resolveLoginAuditTimeoutMs(): number {
  const raw = process.env.LOGIN_AUDIT_TIMEOUT_MS;
  if (!raw) return LOGIN_AUDIT_TIMEOUT_MS_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return LOGIN_AUDIT_TIMEOUT_MS_DEFAULT;
  }
  return parsed;
}

function emitLoginTiming(event: TimingEvent): void {
  if (process.env.LOGIN_PINO_TIMING !== '1') {
    return;
  }
  logger.info(
    {
      ...event,
      surface: 'auth.login',
    },
    'A1 login timing stage completed',
  );
}

// Shared cookie options — ensures set and clear use identical settings
const cookieOptions = () => {
  const isProd = config.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict" as const,
    path: "/",
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  };
};

function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
) {
  const opts = cookieOptions();
  res.cookie("signacare_access", tokens.accessToken, {
    ...opts,
    maxAge: config.jwt.accessTtlMinutes * 60 * 1000,
  });
  res.cookie("signacare_refresh", tokens.refreshToken, {
    ...opts,
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

function clearAuthCookies(res: Response) {
  const opts = cookieOptions();
  res.clearCookie("signacare_access", opts);
  res.clearCookie("signacare_refresh", opts);
}

export const validateLogin = validateBody(LoginSchema);
export const validateMfaVerify = validateBody(MfaVerifySchema);

export async function loginController(req: Request, res: Response) {
  const dto = req.body as LoginDTO;
  const ip = (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined;
  const userAgent = req.headers["user-agent"];
  const timingBase = {
    requestId: req.requestId,
    emit: emitLoginTiming,
  } as const;

  const result = await withTiming(
    'login.authService.login',
    async () => authService.login(dto, {
      ipAddress: ip,
      userAgent: userAgent ?? undefined,
    }),
    timingBase,
  );

  if (!("accessToken" in result)) {
    res.status(200).json({ requiresMfa: true, tempToken: result.tempToken });
    return;
  }

  const loginSuccess = result;
  setAuthCookies(res, {
    accessToken: loginSuccess.accessToken,
    refreshToken: loginSuccess.refreshToken,
  });
  // Prime the Redis idle sliding window for this staff id. The
  // authMiddleware rejects subsequent requests with 401
  // SESSION_EXPIRED once the key expires. Fire-and-forget so any
  // Redis hiccup doesn't block a successful login — but log
  // failures at WARN so operators catch idle-store pressure.
  // BUG-P2 — resolve per-clinic effective idle minutes (PRES-6
  // ceiling 15min; per-clinic override floor 5min). Stored as the
  // Redis value so the middleware can refresh sliding-window TTL
  // without per-request DB lookup. Subsequent Power Settings
  // changes apply on NEXT login.
  effectiveIdleMinutesForClinic(loginSuccess.user.clinicId)
    .then((minutes) => primeIdleWindow(loginSuccess.user.id, minutes))
    .catch(logIdleWindowFailure('prime', loginSuccess.user.id));
  // Mobile clients (X-Client: mobile) cannot read HttpOnly cookies — include tokens in body
  const isMobile = req.headers['x-client'] === 'mobile';
  // Check if staff needs to change temporary password
  const loginTiming = {
    ...timingBase,
    userId: loginSuccess.user.id,
  } as const;
  const loginAuditTimeoutMs = resolveLoginAuditTimeoutMs();
  const { db: staffDb } = await withTiming(
    'login.importStaffDb',
    async () => import('../../db/db'),
    loginTiming,
  );
  const staffRecord = await withTiming(
    'login.readMustChangePasswordFlag',
    async () => staffDb('staff').where({ id: loginSuccess.user.id }).first(),
    loginTiming,
  );
  const mustChangePassword = !!staffRecord?.must_change_password;

  // Write audit log for login.
  // BUG-443 — login MUST complete even if audit_log write fails (HIPAA
  // §164.312(b) audit availability is best-effort), but the failure
  // must be visible. writeAuditLog has built-in outbox recovery; this
  // warn surfaces the rare case where the dynamic import itself fails
  // or a future regression introduces an upstream throw. AHPRA + APP 11
  // require operator-visible audit-trail degradation.
  try {
    // @write-audit-timeout-exempt: login has a stricter user-facing SLA;
    // caller-level timeout prevents auth latency inheritance even when
    // shared writer fallback work continues in the background.
    await withTiming(
      'login.writeAuditLog',
      async () => withTimeout(
        writeAuditLog({
          clinicId: loginSuccess.user.clinicId,
          actorId: loginSuccess.user.id,
          action: 'LOGIN',
          tableName: 'staff_sessions',
          recordId: loginSuccess.user.id,
          ipAddress: ip,
          newData: { email: dto.email, userAgent: userAgent?.substring(0, 100) },
        }),
        loginAuditTimeoutMs,
        'login.writeAuditLog',
      ),
      loginTiming,
    );
  } catch (err) {
    logger.warn(
      {
        err,
        action: 'LOGIN',
        staffId: loginSuccess.user.id,
        clinicId: loginSuccess.user.clinicId,
        kind: 'audit_write_failure',
        timeoutMs: loginAuditTimeoutMs,
      },
      'BUG-443: login audit write failed but login proceeded — AHPRA requires this be visible',
    );
  }

  res.status(200).json({
    requiresMfa: false,
    user: loginSuccess.user,
    mustChangePassword,
    ...(isMobile && {
      accessToken: loginSuccess.accessToken,
      refreshToken: loginSuccess.refreshToken,
    }),
  });
}

export async function mfaVerifyController(req: Request, res: Response) {
  const dto = req.body as MFAVerifyDTO;
  const ip = (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined;
  const userAgent = req.headers["user-agent"];

  const result = await authService.verifyMfa(dto, {
    ipAddress: ip,
    userAgent: userAgent ?? undefined,
  });

  setAuthCookies(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
  const isMobile = req.headers['x-client'] === 'mobile';
  if (isMobile) {
    res.status(200).json({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return;
  }
  res.status(200).json(result.user);
}

export async function refreshController(req: Request, res: Response) {
  const isMobile = req.headers['x-client'] === 'mobile';
  const cookieRefreshToken = req.cookies["signacare_refresh"] as string | undefined;
  const bodyRefreshToken = typeof req.body?.refreshToken === 'string'
    ? req.body.refreshToken
    : undefined;
  const refreshToken = cookieRefreshToken ?? (isMobile ? bodyRefreshToken : undefined);
  if (!refreshToken) {
    throw new HttpError(401, "UNAUTHENTICATED", "No refresh token");
  }

  const result = await authService.refresh(refreshToken);

  setAuthCookies(res, {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  });
  // Prime the idle window again on refresh — a refresh is a form
  // of activity and should reset the sliding window. BUG-P2 —
  // re-resolve per-clinic minutes so a Power Settings change
  // applies on next refresh (faster than waiting for next login).
  effectiveIdleMinutesForClinic(result.user.clinicId)
    .then((minutes) => primeIdleWindow(result.user.id, minutes))
    .catch(logIdleWindowFailure('prime', result.user.id));
  if (isMobile) {
    res.status(200).json({
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    return;
  }
  res.status(200).json(result.user);
}

export async function logoutController(req: Request, res: Response) {
  const refreshToken = req.cookies["signacare_refresh"] as string | undefined;
  if (refreshToken) {
    await authService.logout(refreshToken);
  }
  // Clear the idle window so subsequent requests with the old
  // token are rejected immediately (defence in depth on top of
  // the session-row revocation).
  if (req.user?.id) {
    const staffId = req.user.id;
    clearIdleWindow(staffId).catch(logIdleWindowFailure('clear', staffId));
  }
  // Write audit log for logout.
  // BUG-443 symmetric twin of login site. Same rationale: logout MUST
  // complete; audit-write failure must be visible.
  if (req.user) {
    try {
      await writeAuditLog({
        clinicId: req.user.clinicId,
        actorId: req.user.id,
        action: 'LOGOUT',
        tableName: 'staff_sessions',
        recordId: req.user.id,
        ipAddress: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? undefined,
      });
    } catch (err) {
      logger.warn(
        {
          err,
          action: 'LOGOUT',
          staffId: req.user.id,
          clinicId: req.user.clinicId,
          kind: 'audit_write_failure',
        },
        'BUG-443: logout audit write failed but logout proceeded — AHPRA requires this be visible',
      );
    }
  }
  clearAuthCookies(res);
  res.status(200).json({ success: true });
}

export async function meController(req: Request, res: Response) {
  if (!req.user) {
    throw new HttpError(401, "UNAUTHENTICATED", "Not authenticated");
  }
  // BUG-463 — `req.user` is the `AuthRequestUser` projection (a
  // superset of `AuthUser` with the patient-app role widening +
  // break-glass + impersonation typed-optional fields). Echoing it
  // directly preserves the wire shape callers already depend on.
  res.status(200).json(req.user);
}
