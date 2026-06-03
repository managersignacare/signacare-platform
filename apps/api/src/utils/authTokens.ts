// apps/api/src/utils/authTokens.ts
//
// BUG-463 — JWT-payload discriminated union + typed verifyAccessToken /
// discriminate helpers.
//
// Why this file exists:
// Pre-BUG-463, every middleware that read non-base claims off the JWT
// (`breakGlass`, `breakGlassSessionId`, `impersonator`,
// `impersonationSessionId`, `patientId`, `isPatientApp`) had to spell
// `payload as unknown as { ... }` shape-extension casts because those
// claims were stamped at issuance time but never declared on a single
// `AccessTokenPayload` type. Five-plus issuers stamped overlapping
// subsets of claims — patient-app login (`isPatientApp + patientId`),
// break-glass (`breakGlass + breakGlassSessionId`), admin
// impersonation (`impersonator + impersonationSessionId`), staff
// (none), and webauthn temp tokens (separate type — out of scope).
//
// This module is the SSoT for the access-token shape. The discriminated
// union narrows correctly on `kind`, so the cast contagion stops here:
// every consumer either reads `verifyAccessToken(token)` and discriminates
// via `kind`, or reads `req.user` (the flat projection authMiddleware
// builds from the discriminated payload — see `types/express.d.ts` for
// the typed-optional fields).
//
// Two-tier design rationale:
//   - Discriminated union AT the verification boundary (precision) —
//     the single point where untyped JWT bytes become typed claims.
//   - Flat projection ON `req.user` (low blast-radius) — adopting the
//     discriminated union directly on `req.user` would cascade into
//     several hundred route handlers that read `req.user.id`. The
//     projection adds 4 typed-optional fields to the existing AuthUser
//     shape; readers that don't care continue to compile unchanged.
//
// Issuance-side stays untouched: `discriminate()` infers `kind` from
// the existing distinguishing flags (`isPatientApp`, `breakGlass`,
// `impersonator`). A future tightening (BUG-463-FU, post-staging)
// stamps `kind` directly at sign time so the inference is collapsed.

import jwt from 'jsonwebtoken';
import { ROLE_PERMISSIONS, type Role, type Permission } from '@signacare/shared';
import { config } from '../config';

interface BaseClaims {
  iat: number;
  exp: number;
  jti?: string;
}

interface StaffBaseClaims extends BaseClaims {
  id: string;
  clinicId: string;
  role: Role;
  permissions: Permission[];
  givenName: string;
  familyName: string;
  email?: string | null;
}

export interface StaffAccessClaims extends StaffBaseClaims {
  kind: 'staff';
}

export interface StaffBreakGlassAccessClaims extends StaffBaseClaims {
  kind: 'staff_break_glass';
  breakGlass: true;
  breakGlassSessionId: string;
}

export interface StaffImpersonationAccessClaims extends StaffBaseClaims {
  kind: 'staff_impersonation';
  impersonator: string;
  impersonationSessionId: string;
}

export interface PatientAppAccessClaims extends BaseClaims {
  kind: 'patient_app';
  id: string;            // patient_app_accounts.id
  patientId: string;     // patients.id (NON-optional in this variant)
  clinicId: string;
  role: 'patient';
  givenName?: string;
  familyName?: string;
  isPatientApp: true;
}

export type AccessTokenPayload =
  | StaffAccessClaims
  | StaffBreakGlassAccessClaims
  | StaffImpersonationAccessClaims
  | PatientAppAccessClaims;

const STAFF_ROLE_SET = new Set<Role>(Object.keys(ROLE_PERMISSIONS) as Role[]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasOwn(raw: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

function readString(
  raw: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid access token payload (${context}): "${key}" must be a non-empty string`);
  }
  return value;
}

function readOptionalString(
  raw: Record<string, unknown>,
  key: string,
  context: string,
): string | undefined {
  if (!hasOwn(raw, key) || raw[key] == null) {
    return undefined;
  }
  const value = raw[key];
  if (typeof value !== 'string') {
    throw new Error(`Invalid access token payload (${context}): "${key}" must be a string when present`);
  }
  return value;
}

function readStaffRole(raw: Record<string, unknown>, context: string): Role {
  const role = readString(raw, 'role', context);
  if (!STAFF_ROLE_SET.has(role as Role)) {
    throw new Error(`Invalid access token payload (${context}): unsupported staff role "${role}"`);
  }
  return role as Role;
}

function readIat(raw: Record<string, unknown>, context: string): number {
  const iat = raw.iat;
  if (!isFiniteNumber(iat)) {
    throw new Error(`Invalid access token payload (${context}): "iat" must be a number`);
  }
  return iat;
}

function readExp(raw: Record<string, unknown>, context: string): number {
  const exp = raw.exp;
  if (!isFiniteNumber(exp)) {
    throw new Error(`Invalid access token payload (${context}): "exp" must be a number`);
  }
  return exp;
}

function readPermissions(raw: Record<string, unknown>, context: string): Permission[] {
  const permissions = raw.permissions;
  if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== 'string')) {
    throw new Error(`Invalid access token payload (${context}): "permissions" must be a string[]`);
  }
  return permissions as Permission[];
}

function buildStaffBase(raw: Record<string, unknown>, context: string): StaffBaseClaims {
  return {
    id: readString(raw, 'id', context),
    clinicId: readString(raw, 'clinicId', context),
    role: readStaffRole(raw, context),
    permissions: readPermissions(raw, context),
    givenName: readString(raw, 'givenName', context),
    familyName: readString(raw, 'familyName', context),
    email: readOptionalString(raw, 'email', context),
    iat: readIat(raw, context),
    exp: readExp(raw, context),
    jti: readOptionalString(raw, 'jti', context),
  };
}

/**
 * Verify and discriminate a JWT presented to the API. Throws on
 * invalid signature, expiry, or any other jsonwebtoken verify failure.
 * The `kind` discriminator is applied by `discriminate` based on which
 * distinguishing flags are present on the decoded payload.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const raw = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] }) as Record<string, unknown> &
    BaseClaims;
  return discriminate(raw);
}

/**
 * Pure variant-assignment for an already-decoded JWT payload. Exported
 * for unit-testing and for the rare caller that has the decoded object
 * already (e.g. WS-upgrade handshake that runs verify in a different
 * scope). Order matters — check patient-app first because patient-app
 * tokens never carry break-glass / impersonation flags, but staff
 * tokens may carry one or the other (never both — see `discriminate`
 * for the mutually-exclusive guard).
 *
 * Defence in depth: a malicious payload that includes BOTH a patient-app
 * flag AND a staff-only flag (e.g. `isPatientApp: true` + `breakGlass:
 * true`) is treated as `patient_app` because it's the most-restrictive
 * variant — patient-app tokens cannot pass any staff-role gate, so
 * misclassifying a hostile token as `patient_app` fails closed. The
 * issuance side never mints such a payload.
 */
export function discriminate(
  raw: Record<string, unknown> & BaseClaims,
): AccessTokenPayload {
  const hasPatientAppFlag = raw.isPatientApp === true || hasOwn(raw, 'patientId') || raw.role === 'patient';
  const hasBreakGlassClaims = raw.breakGlass === true || hasOwn(raw, 'breakGlassSessionId');
  const hasImpersonationClaims = hasOwn(raw, 'impersonator') || hasOwn(raw, 'impersonationSessionId');

  if (hasPatientAppFlag) {
    if (raw.isPatientApp !== true) {
      throw new Error('Invalid access token payload (patient_app): "isPatientApp" must be true');
    }
    if (typeof raw.patientId !== 'string' || raw.patientId.trim() === '') {
      throw new Error('Invalid access token payload (patient_app): "patientId" must be a non-empty string');
    }
    if (raw.role !== 'patient') {
      throw new Error('Invalid access token payload (patient_app): "role" must be "patient"');
    }
    if (hasBreakGlassClaims || hasImpersonationClaims || hasOwn(raw, 'permissions')) {
      throw new Error('Invalid access token payload (patient_app): staff-only claims are not allowed');
    }
    return {
      kind: 'patient_app',
      id: readString(raw, 'id', 'patient_app'),
      patientId: raw.patientId,
      clinicId: readString(raw, 'clinicId', 'patient_app'),
      role: 'patient',
      givenName: readOptionalString(raw, 'givenName', 'patient_app'),
      familyName: readOptionalString(raw, 'familyName', 'patient_app'),
      isPatientApp: true,
      iat: readIat(raw, 'patient_app'),
      exp: readExp(raw, 'patient_app'),
      jti: readOptionalString(raw, 'jti', 'patient_app'),
    };
  }

  if (hasBreakGlassClaims) {
    if (raw.breakGlass !== true || typeof raw.breakGlassSessionId !== 'string') {
      throw new Error(
        'Invalid access token payload (staff_break_glass): "breakGlass=true" and "breakGlassSessionId" are required together',
      );
    }
    if (hasImpersonationClaims) {
      throw new Error('Invalid access token payload (staff_break_glass): impersonation claims are not allowed');
    }
    return {
      ...buildStaffBase(raw, 'staff_break_glass'),
      kind: 'staff_break_glass',
      breakGlass: true,
      breakGlassSessionId: raw.breakGlassSessionId,
    };
  }

  if (hasImpersonationClaims) {
    if (typeof raw.impersonator !== 'string' || typeof raw.impersonationSessionId !== 'string') {
      throw new Error(
        'Invalid access token payload (staff_impersonation): "impersonator" and "impersonationSessionId" are required together',
      );
    }
    return {
      ...buildStaffBase(raw, 'staff_impersonation'),
      kind: 'staff_impersonation',
      impersonator: raw.impersonator,
      impersonationSessionId: raw.impersonationSessionId,
    };
  }

  return {
    ...buildStaffBase(raw, 'staff'),
    kind: 'staff',
  };
}
