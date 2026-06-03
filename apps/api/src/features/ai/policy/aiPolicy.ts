import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import {
  AiStructuredScopeSchema,
  type AiStructuredScope,
} from '@signacare/shared';
import { AppError } from '../../../shared/errors';
import { db } from '../../../db/db';
import { logger } from '../../../utils/logger';
import { resolvePolicyToolAllowlist } from '../tools/toolPolicy';
import { writeAiPolicyDecisionAudit } from '../audit/aiAudit';

// @jsonb-extraction-exempt: policy-only middleware performs clinic-scope existence checks on staff/org_units.
// No staff/org_units row is mapped to an HTTP response payload from this file.

type PurposeOfUse = 'clinical' | 'operational' | 'analytics';

interface AuthorizeAiRequestOptions {
  routeId: 'clinical-ai' | 'agent' | 'suggest' | 'scribe' | 'mcp';
  allowedPurposes: PurposeOfUse[];
}

export interface AiDecisionToken {
  tokenId: string;
  clinicId: string;
  staffId: string;
  role: string;
  permissions: string[];
  allowedTools?: string[];
  purposeOfUse: PurposeOfUse;
  scope?: AiStructuredScope;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000;

const AI_SCOPE_KEY_ORDER: Array<keyof AiStructuredScope> = [
  'level',
  'patientIds',
  'teamIds',
  'staffIds',
  'teamLabels',
  'staffLabels',
  'timeRangeFrom',
  'timeRangeTo',
];

interface DecisionTokenSigningInput {
  tokenId: string;
  clinicId: string;
  staffId: string;
  role: string;
  permissions: string[];
  allowedTools?: string[];
  purposeOfUse: PurposeOfUse;
  scope?: AiStructuredScope;
  issuedAt: string;
  expiresAt: string;
}

function policyTokenSecret(): string {
  return process.env['AI_POLICY_TOKEN_SECRET']
    ?? process.env['JWT_SECRET']
    ?? process.env['ACCESS_TOKEN_SECRET']
    ?? 'ai-policy-dev-secret';
}

function canonicalScopeString(scope: AiStructuredScope | undefined): string {
  if (!scope) return '';
  const canonical: Partial<AiStructuredScope> = {};
  for (const key of AI_SCOPE_KEY_ORDER) {
    const value = scope[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      canonical[key] = [...value].sort() as never;
    } else {
      canonical[key] = value as never;
    }
  }
  return JSON.stringify(canonical);
}

function buildDecisionPayload(input: DecisionTokenSigningInput): string {
  return [
    input.tokenId,
    input.clinicId,
    input.staffId,
    input.role,
    [...input.permissions].sort().join(','),
    [...(input.allowedTools ?? [])].sort().join(','),
    input.purposeOfUse,
    canonicalScopeString(input.scope),
    input.issuedAt,
    input.expiresAt,
  ].join('|');
}

function signDecisionPayload(input: DecisionTokenSigningInput): string {
  return crypto
    .createHmac('sha256', policyTokenSecret())
    .update(buildDecisionPayload(input))
    .digest('hex');
}

export function assertValidDecisionToken(token: AiDecisionToken): void {
  const nowMs = Date.now();
  const issuedAtMs = Date.parse(token.issuedAt);
  const expiresAtMs = Date.parse(token.expiresAt);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) {
    throw new AppError('AI decision token has invalid timestamp fields', 403, 'AI_POLICY_TOKEN_INVALID');
  }
  if (nowMs > expiresAtMs) {
    throw new AppError('AI decision token has expired', 403, 'AI_POLICY_TOKEN_EXPIRED');
  }
  const expectedSignature = signDecisionPayload({
    tokenId: token.tokenId,
    clinicId: token.clinicId,
    staffId: token.staffId,
    role: token.role,
    permissions: token.permissions,
    allowedTools: token.allowedTools,
    purposeOfUse: token.purposeOfUse,
    scope: token.scope,
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
  });
  if (expectedSignature !== token.signature) {
    throw new AppError('AI decision token signature mismatch', 403, 'AI_POLICY_TOKEN_INVALID');
  }
}

export function issueAiDecisionToken(input: {
  clinicId: string;
  staffId: string;
  role: string;
  permissions: string[];
  allowedTools?: string[];
  purposeOfUse: PurposeOfUse;
  scope?: AiStructuredScope;
}): AiDecisionToken {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + DEFAULT_TOKEN_TTL_MS);
  const tokenId = crypto.randomUUID();
  const issuedAtIso = issuedAt.toISOString();
  const expiresAtIso = expiresAt.toISOString();
  const signature = signDecisionPayload({
    tokenId,
    clinicId: input.clinicId,
    staffId: input.staffId,
    role: input.role,
    permissions: input.permissions,
    allowedTools: input.allowedTools,
    purposeOfUse: input.purposeOfUse,
    scope: input.scope,
    issuedAt: issuedAtIso,
    expiresAt: expiresAtIso,
  });
  return {
    tokenId,
    clinicId: input.clinicId,
    staffId: input.staffId,
    role: input.role,
    permissions: input.permissions,
    allowedTools: input.allowedTools,
    purposeOfUse: input.purposeOfUse,
    scope: input.scope,
    issuedAt: issuedAtIso,
    expiresAt: expiresAtIso,
    signature,
  };
}

async function ensureTeamScopeBelongsToClinic(clinicId: string, teamIds: string[]): Promise<void> {
  if (!teamIds.length) return;
  const rows = await db('org_units')
    .whereIn('id', teamIds)
    .where({ clinic_id: clinicId, is_active: true })
    .select('id');
  if (rows.length !== teamIds.length) {
    throw new AppError('Team scope contains invalid or cross-clinic teams', 403, 'SCOPE_MISMATCH');
  }
}

async function ensureStaffScopeBelongsToClinic(clinicId: string, staffIds: string[]): Promise<void> {
  if (!staffIds.length) return;
  const rows = await db('staff')
    .whereIn('id', staffIds)
    .where({ clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('id');
  if (rows.length !== staffIds.length) {
    throw new AppError('Staff scope contains invalid or cross-clinic staff', 403, 'SCOPE_MISMATCH');
  }
}

function resolvePurposeOfUse(req: Request): PurposeOfUse {
  const raw = (req.body as { purposeOfUse?: unknown } | undefined)?.purposeOfUse;
  if (raw === 'clinical' || raw === 'operational' || raw === 'analytics') {
    return raw;
  }
  return 'clinical';
}

function resolveScope(
  routeId: AuthorizeAiRequestOptions['routeId'],
  rawScope: unknown,
  patientId: unknown,
): AiStructuredScope {
  if (rawScope !== undefined) {
    return AiStructuredScopeSchema.parse(rawScope);
  }
  const normalizedPatientId = typeof patientId === 'string' ? patientId.trim() : '';
  if (normalizedPatientId.length > 0) {
    return {
      level: 'patient',
      patientIds: [normalizedPatientId],
    };
  }
  // Backward-compatible default for legacy callers that have not yet
  // migrated to explicit structured scopes.
  void routeId;
  return { level: 'clinic' };
}

export function authorizeAiRequest(options: AuthorizeAiRequestOptions) {
  return async function aiPolicyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId;
      const staffId = req.user?.id;
      const roleRaw = req.user?.role;
      if (!clinicId || !staffId || !roleRaw) {
        throw new AppError('Missing authenticated AI request context', 401, 'UNAUTHENTICATED');
      }

      const purposeOfUse = resolvePurposeOfUse(req);
      if (!options.allowedPurposes.includes(purposeOfUse)) {
        throw new AppError('Purpose-of-use is not allowed for this AI endpoint', 403, 'PURPOSE_NOT_ALLOWED');
      }

      const rawScope = (req.body as { scope?: unknown } | undefined)?.scope;
      const patientId = (req.body as { patientId?: unknown } | undefined)?.patientId;
      const scope = resolveScope(options.routeId, rawScope, patientId);
      const role = String(roleRaw);
      const allowedTools = resolvePolicyToolAllowlist({
        purposeOfUse,
        role,
        scopeLevel: scope.level,
      });

      if (scope?.level === 'team') {
        await ensureTeamScopeBelongsToClinic(clinicId, scope.teamIds ?? []);
      }
      if (scope?.level === 'staff') {
        await ensureStaffScopeBelongsToClinic(clinicId, scope.staffIds ?? []);
      }

      if (typeof patientId === 'string' && scope?.level === 'patient') {
        const inScope = (scope.patientIds ?? []).includes(patientId);
        if (!inScope) {
          throw new AppError('patientId is outside request scope', 403, 'SCOPE_MISMATCH');
        }
      }

      (res.locals as { aiDecisionToken?: AiDecisionToken }).aiDecisionToken = issueAiDecisionToken({
        clinicId,
        staffId,
        role,
        permissions: Array.isArray(req.user?.permissions) ? req.user.permissions.map(String) : [],
        allowedTools,
        purposeOfUse,
        scope,
      });
      (
        res.locals as {
          aiPolicyDecision?: {
            routeId: AuthorizeAiRequestOptions['routeId'];
            purposeOfUse: PurposeOfUse;
            scope: AiStructuredScope;
            allowedTools: string[];
          };
        }
      ).aiPolicyDecision = {
        routeId: options.routeId,
        purposeOfUse,
        scope,
        allowedTools,
      };
      await writeAiPolicyDecisionAudit({
        req,
        routeId: options.routeId,
        purposeOfUse,
        scope,
        decisionTokenId: (res.locals as { aiDecisionToken?: AiDecisionToken }).aiDecisionToken?.tokenId,
      }).catch((err: unknown) => {
        logger.warn(
          { err, clinicId, staffId, routeId: options.routeId },
          'AI policy decision audit write failed (non-blocking)',
        );
      });
      next();
    } catch (err) {
      next(err);
    }
  };
}
