import type { Request } from 'express';
import type { AuthContext, AiStructuredScope } from '@signacare/shared';
import { writeAuditLog } from '../../../utils/audit';

type AiRouteId = 'suggest' | 'clinical-ai' | 'agent' | 'mcp' | 'scribe';

function scopeSummary(scope: AiStructuredScope | undefined): Record<string, unknown> {
  if (!scope) return { level: 'clinic' };
  return {
    level: scope.level,
    patientIds: scope.patientIds ?? [],
    teamIds: scope.teamIds ?? [],
    staffIds: scope.staffIds ?? [],
    timeRangeFrom: scope.timeRangeFrom ?? null,
    timeRangeTo: scope.timeRangeTo ?? null,
  };
}

export async function writeAiPolicyDecisionAudit(params: {
  req: Request;
  routeId: AiRouteId;
  purposeOfUse: 'clinical' | 'operational' | 'analytics';
  scope: AiStructuredScope;
  decisionTokenId?: string;
}): Promise<void> {
  await writeAuditLog({
    clinicId: params.req.clinicId,
    actorId: params.req.user?.id ?? '',
    action: 'ACCESS',
    tableName: 'llm_interactions',
    recordId: params.decisionTokenId ?? '00000000-0000-0000-0000-000000000000',
    newData: {
      routeId: params.routeId,
      purposeOfUse: params.purposeOfUse,
      scope: scopeSummary(params.scope),
      requestId: params.req.requestId ?? null,
    },
  });
}

export async function writeAiToolCallAudit(params: {
  auth: AuthContext;
  toolName: string;
  argumentsSummary: Record<string, unknown>;
  success: boolean;
  errorCode?: string;
}): Promise<void> {
  await writeAuditLog({
    clinicId: params.auth.clinicId,
    actorId: params.auth.staffId,
    action: params.success ? 'ACCESS' : 'FORBIDDEN_ACCESS',
    tableName: 'llm_interactions',
    recordId: params.auth.aiDecisionToken?.tokenId ?? '00000000-0000-0000-0000-000000000000',
    newData: {
      toolName: params.toolName,
      scope: scopeSummary(params.auth.aiScope),
      purposeOfUse: params.auth.aiPurposeOfUse ?? 'clinical',
      argumentsSummary: params.argumentsSummary,
      errorCode: params.errorCode ?? null,
    },
  });
}
