// apps/api/src/services/authService.ts
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import {
  LoginDTO,
  MFAVerifyDTO,
  AuthUser,
  ROLE_PERMISSIONS,
  Role,
} from "@signacare/shared";
import { StaffRepository } from "../staff/staffRepository";
import { AuthRepository } from "./authRepository";
import { HttpError } from "../../shared/errors";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { writeAuditLog } from "../../utils/audit";
import type { StaffSessionsRow } from '../../db/types/staff_sessions';
import {
  isAuthChainTimeoutError,
  withAuthChainStageTimeout,
} from '../../shared/authChainTimeout';
import { assertPasswordNotBreached } from './passwordBreachService';
import { redis } from '../../config/redis';
import { assertSuperadminSessionEligibility } from '../../shared/superadminPolicy';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const MFA_TEMP_TTL_MINUTES = 10;
const MAX_MFA_ATTEMPTS = 5;

interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

type LoginResult =
  | { mfaRequired: true; tempToken: string }
  | AuthResult;

interface TempTokenPayload {
  sub: string;
  clinicId: string;
  purpose: "mfa_pending";
  iat: number;
  exp: number;
}

function buildAuthUser(staffId: string, clinicId: string, role: Role, givenName: string, familyName: string, email: string): AuthUser {
  const normalizedRole = role.toLowerCase() as Role;
  return {
    id: staffId,
    clinicId,
    givenName,
    familyName,
    email,
    role: normalizedRole,
    permissions: ROLE_PERMISSIONS[normalizedRole] ?? [],
  };
}

export function issueTokens(user: AuthUser): { accessToken: string; refreshToken: string } {
  return {
    accessToken: issueAccessToken(user),
    refreshToken: issueRefreshToken(user),
  };
}

function issueAccessToken(user: AuthUser): string {
  // Add a random jti so two tokens issued in the same second for
  // the same user (e.g. two back-to-back logins in a test run)
  // don't collide. Also satisfies RFC 7519 §4.1.7 uniqueness.
  const accessJti = uuidv4();
  return jwt.sign(
    { ...user, jti: accessJti },
    config.jwt.accessSecret,
    { expiresIn: `${config.jwt.accessTtlMinutes}m` },
  );
}

function issueRefreshToken(user: AuthUser): string {
  const refreshJti = uuidv4();
  return jwt.sign(
    { sub: user.id, clinicId: user.clinicId, jti: refreshJti },
    config.jwt.refreshSecret,
    { expiresIn: `${config.jwt.refreshTtlDays}d` },
  );
}

function issueTempToken(staffId: string, clinicId: string): string {
  return jwt.sign(
    { sub: staffId, clinicId, purpose: "mfa_pending" },
    config.jwt.accessSecret,
    { expiresIn: `${MFA_TEMP_TTL_MINUTES}m` }
  );
}

export class AuthService {
  private staffRepo = new StaffRepository();
  private authRepo = new AuthRepository();

  private async createFreshSessionForUser(
    user: AuthUser,
    staffId: string,
    clinicId: string,
    ctx: LoginContext,
  ): Promise<AuthResult> {
    const refreshToken = issueRefreshToken(user);
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.authRepo.createSession({
      id: uuidv4(),
      staff_id: staffId,
      clinic_id: clinicId,
      refresh_token: refreshToken,
      user_agent: ctx.userAgent ?? null,
      ip_address: ctx.ipAddress ?? null,
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
      revoked_at: null,
      lock_version: 1,
      family_id: uuidv4(),
    });

    return {
      accessToken: issueAccessToken(user),
      refreshToken,
      user,
    };
  }

  async login(dto: LoginDTO, ctx: LoginContext): Promise<LoginResult> {
    const staff = await this.staffRepo.findByEmail(dto.email);
    if (!staff) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }
    assertSuperadminSessionEligibility({
      role: staff.role,
      email: staff.email,
    });

    if (staff.locked_until && staff.locked_until > new Date()) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Account temporarily locked. Please try again later.");
    }

    const passwordMatch = await bcrypt.compare(dto.password, staff.password_hash);
    if (!passwordMatch) {
      const lockState = await this.staffRepo.recordFailedLoginAttempt(
        staff.id,
        MAX_FAILED_ATTEMPTS,
        LOCKOUT_MINUTES,
      );
      if (lockState.lockedUntil && lockState.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        logger.warn(
          { staffId: staff.id, clinicId: staff.clinic_id },
          "Account locked after failed attempts",
        );
      }
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    await this.staffRepo.resetFailedLogins(staff.id);

    // Phase 0.7.2 (#20): MFA required for ALL roles that access PHI.
    // Previously only clinician/admin/superadmin — receptionist,
    // nurse, manager could access patient demographics without MFA.
    const MFA_REQUIRED_ROLES = [
      'clinician', 'admin', 'superadmin', 'nurse',
      'receptionist', 'manager', 'referral_coordinator',
      'prescriber_consultant', 'prescriber_registrar',
      'prescriber_hmo', 'prescriber_nurse_practitioner',
    ];
    const requiresMfa =
      staff.mfa_enabled &&
      !!staff.mfa_secret &&
      MFA_REQUIRED_ROLES.includes(staff.role);

    if (requiresMfa) {
      const tempToken = issueTempToken(staff.id, staff.clinic_id);
      return { mfaRequired: true, tempToken };
    }

    const user = buildAuthUser(
      staff.id,
      staff.clinic_id,
      staff.role as Role,
      staff.given_name,
      staff.family_name,
      staff.email
    );
    // BUG-WF21-JWT-GHOST-SESSION:
    // persist refresh session FIRST; mint access JWT only after durable session insert.
    const session = await this.createFreshSessionForUser(user, staff.id, staff.clinic_id, ctx);

    // GAP-20: Concurrent session limit — max 5 active sessions per user
    const MAX_SESSIONS = 5;
    try {
      const { db: sessionDb } = await import('../../db/db');
      const activeSessions = await withAuthChainStageTimeout(
        'auth.login.session_cap.query',
        sessionDb<StaffSessionsRow>('staff_sessions')
          .where({ staff_id: staff.id }).whereNull('revoked_at')
          .where('expires_at', '>', new Date())
          .orderBy('created_at', 'desc'),
      );
      if (activeSessions.length > MAX_SESSIONS) {
        const toRevoke = activeSessions.slice(MAX_SESSIONS).map((session) => session.id);
        await withAuthChainStageTimeout(
          'auth.login.session_cap.revoke',
          this.authRepo.revokeSessionsByIds(toRevoke),
        );
        logger.info(
          { staffId: staff.id, revoked: toRevoke.length },
          'Revoked excess sessions',
        );
      }
    } catch (sessionErr) {
      logger.warn(
        {
          err: sessionErr,
          staffId: staff.id,
          clinicId: staff.clinic_id,
          kind: 'auth_login_best_effort_stage_failed',
          reason: isAuthChainTimeoutError(sessionErr) ? 'timeout' : 'upstream_error',
        },
        'A1a: session-cap best-effort stage failed; login continues',
      );
    }

    logger.info(
      { staffId: staff.id, clinicId: staff.clinic_id },
      "Staff logged in",
    );
    return session;
  }

  async verifyMfa(dto: MFAVerifyDTO, ctx: LoginContext): Promise<AuthResult> {
    let payload: TempTokenPayload;
    try {
      payload = jwt.verify(dto.tempToken, config.jwt.accessSecret, { algorithms: ['HS256'] }) as TempTokenPayload;
    } catch (err) {
      logger.warn(
        {
          err,
          kind: 'mfa_temp_token_verify_failed',
        },
        'verifyMfa: temp token verification failed',
      );
      throw new HttpError(401, "UNAUTHENTICATED", "Temp token is invalid or expired");
    }

    if (payload.purpose !== "mfa_pending") {
      throw new HttpError(401, "UNAUTHENTICATED", "Invalid token purpose");
    }

    // BUG-WF21-OTP-CAP-MISSING / auth fragility:
    // verifyMfa needs mfa_secret. findById() intentionally uses the
    // SAFE_STAFF_COLUMNS projection and omits mfa_secret, which
    // incorrectly yields MFA_NOT_CONFIGURED for valid MFA accounts.
    // Use the auth-only row loader that includes secret fields.
    const staff = await this.staffRepo.findByIdWithHash(payload.sub);
    if (!staff) {
      throw new HttpError(401, "UNAUTHENTICATED", "Staff not found");
    }
    assertSuperadminSessionEligibility({
      role: staff.role,
      email: staff.email,
    });

    if (!staff.mfa_secret) {
      throw new HttpError(401, "MFA_NOT_CONFIGURED", "MFA is not configured for this account");
    }

    const mfaAttemptsKey = `auth:mfa_attempts:${staff.id}`;
    try {
      const currentAttempts = Number(await redis.get(mfaAttemptsKey) ?? 0);
      if (currentAttempts >= MAX_MFA_ATTEMPTS) {
        throw new HttpError(
          429,
          'MFA_ATTEMPTS_EXCEEDED',
          'Too many invalid MFA attempts. Please sign in again.',
        );
      }
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      logger.warn(
        {
          err,
          kind: 'mfa_attempts_counter_read_failed',
          staffId: staff.id,
        },
        'verifyMfa: could not read MFA attempt counter; continuing with verify',
      );
    }

    const isValid = speakeasy.totp.verify({
      secret: staff.mfa_secret,
      encoding: "base32",
      token: dto.token,
      window: 1,
    });

    if (!isValid) {
      try {
        const attempts = await redis.incr(mfaAttemptsKey);
        if (attempts === 1) {
          await redis.expire(mfaAttemptsKey, MFA_TEMP_TTL_MINUTES * 60);
        }
      } catch (err) {
        logger.warn(
          {
            err,
            kind: 'mfa_attempts_counter_write_failed',
            staffId: staff.id,
          },
          'verifyMfa: failed to persist MFA attempt count',
        );
      }
      throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid MFA code");
    }

    try {
      await redis.del(mfaAttemptsKey);
    } catch (err) {
      logger.warn(
        {
          err,
          kind: 'mfa_attempts_counter_clear_failed',
          staffId: staff.id,
        },
        'verifyMfa: failed to clear MFA attempt counter after success',
      );
    }

    const user = buildAuthUser(
      staff.id,
      staff.clinic_id,
      staff.role as Role,
      staff.given_name,
      staff.family_name,
      staff.email
    );
    // BUG-WF21-JWT-GHOST-SESSION:
    // persist refresh session FIRST; mint access JWT only after durable session insert.
    const session = await this.createFreshSessionForUser(user, staff.id, staff.clinic_id, ctx);

    logger.info(
      { staffId: staff.id, clinicId: staff.clinic_id },
      "MFA verified",
    );
    return session;
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const session = await this.authRepo.findSessionByToken(refreshToken);
    if (!session) {
      // RFC 6819 §5.2.2.3 reuse detection: if the presented token
      // matches a session that is already revoked (i.e. previously
      // rotated), the token is being replayed. Revoke the entire
      // family so a stolen chain cannot keep rotating.
      const anySession = await this.authRepo.findAnySessionByToken(refreshToken);
      if (anySession && anySession.revoked_at) {
        const revoked = await this.authRepo.revokeSessionFamily(anySession.family_id);
        logger.warn(
          {
            staffId: anySession.staff_id,
            clinicId: anySession.clinic_id,
            familyId: anySession.family_id,
            revoked,
          },
          'Refresh-token reuse detected — revoked entire session family (RFC 6819 §5.2.2.3)',
        );
        throw new HttpError(
          401,
          'SESSION_REUSED',
          'Refresh token reuse detected — all sessions in this family have been revoked',
        );
      }
      throw new HttpError(401, "SESSION_EXPIRED", "Session not found or revoked");
    }
    if (session.expires_at < new Date()) {
      await this.authRepo.revokeSession(session.id);
      throw new HttpError(401, "SESSION_EXPIRED", "Session has expired");
    }

    const staff = await this.staffRepo.findById(session.staff_id);
    if (!staff || !staff.is_active) {
      throw new HttpError(401, "UNAUTHENTICATED", "Staff account inactive or not found");
    }
    assertSuperadminSessionEligibility({
      role: staff.role,
      email: staff.email,
    });

    const user = buildAuthUser(
      staff.id,
      staff.clinic_id,
      staff.role as Role,
      staff.given_name,
      staff.family_name,
      staff.email
    );
    // Persist refresh-session rotation first; mint access JWT only after durable session write.
    const nextRefreshToken = issueRefreshToken(user);

    await this.authRepo.revokeSession(session.id);
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);
    await this.authRepo.createSession({
      id: uuidv4(),
      staff_id: staff.id,
      clinic_id: staff.clinic_id,
      refresh_token: nextRefreshToken,
      user_agent: session.user_agent,
      ip_address: session.ip_address,
      expires_at: expiresAt,
      created_at: new Date(),
      updated_at: new Date(),
      revoked_at: null,
      lock_version: 1,
      // RFC 6819 §5.2.2.3: PROPAGATE the family_id from the rotated
      // session so a subsequent reuse of the old token can revoke
      // this child too.
      family_id: session.family_id,
    });
    const accessToken = issueAccessToken(user);

    return { accessToken, refreshToken: nextRefreshToken, user };
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.authRepo.findSessionByToken(refreshToken);
    if (session) {
      await this.authRepo.revokeSession(session.id);
    }
  }

  /**
   * HIPAA §164.312(d) — Password change with current-password verification,
   * strength validation, session revocation, and audit logging.
   */
  async changePassword(
    staffId: string,
    clinicId: string,
    currentPassword: string,
    newPassword: string,
    ctx: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
    // 1. Fetch the full staff record (including password_hash)
    const staff = await this.staffRepo.findByIdWithHash(staffId);
    if (!staff) {
      throw new HttpError(404, "NOT_FOUND", "Staff account not found");
    }

    // 2. Verify current password
    const match = await bcrypt.compare(currentPassword, staff.password_hash);
    if (!match) {
      throw new HttpError(401, "INVALID_CREDENTIALS", "Current password is incorrect");
    }

    // 3. Validate new password strength (HIPAA: min 8 chars, upper, lower, digit, special)
    const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~])/;
    if (newPassword.length < 8) {
      throw new HttpError(400, "WEAK_PASSWORD", "Password must be at least 8 characters");
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      throw new HttpError(
        400,
        "WEAK_PASSWORD",
        "Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character",
      );
    }

    // 4. Prevent reuse of current password
    const sameAsOld = await bcrypt.compare(newPassword, staff.password_hash);
    if (sameAsOld) {
      throw new HttpError(400, "PASSWORD_REUSED", "New password must differ from the current password");
    }

    // BUG-P4 — breached-password gate (k-anonymity lookup), fail-open on
    // upstream degradation per policy, and enabled only under feature flag.
    await assertPasswordNotBreached(
      {
        staffId,
        clinicId,
        role: staff.role,
        permissions: [],
      },
      newPassword,
      { surface: 'auth.change-password' },
    );

    // 5. Hash with bcrypt cost 12
    const newHash = await bcrypt.hash(newPassword, 12);

    // 6. Update the staff record
    await this.staffRepo.updatePasswordHash(staffId, newHash);

    // 7. Revoke ALL sessions (force re-login everywhere)
    await this.authRepo.revokeSessionsForStaff(staffId);

    // 8. Write audit log
    await writeAuditLog(
      { clinicId, userId: staffId, ipAddress: ctx.ipAddress },
      {
        tableName: "staff",
        recordId: staffId,
        action: "UPDATE",
        newValues: { field: "password_hash", note: "Password changed by user" },
      },
    );

    logger.info(
      { staffId, clinicId },
      "Password changed",
    );

    const user = buildAuthUser(
      staff.id,
      staff.clinic_id,
      staff.role as Role,
      staff.given_name,
      staff.family_name,
      staff.email,
    );

    return this.createFreshSessionForUser(user, staff.id, staff.clinic_id, ctx);
  }

  async revokeSessionsForStaff(staffId: string): Promise<void> {
    await this.authRepo.revokeSessionsForStaff(staffId);
  }
}
