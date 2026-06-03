import type { AuthContext, AiStructuredScope } from '@signacare/shared';
import { AppError } from '../../../shared/errors';
import {
  CLINIC_WIDE_MCP_TOOLS,
  MCP_NON_DB_TOOLS,
  MCP_TOOLS,
  PATIENT_SCOPED_MCP_TOOLS,
} from '../../../mcp/server/mcpToolCatalog';

type PurposeOfUse = 'clinical' | 'operational' | 'analytics';
type ScopeLevel = AiStructuredScope['level'];
type DataSensitivity = 'low' | 'phi' | 'critical';

interface ToolPolicyContract {
  toolName: string;
  allowedPurposes: PurposeOfUse[];
  allowedScopeLevels: ScopeLevel[];
  dataSensitivity: DataSensitivity;
  requiresJustification: boolean;
}

const TOOL_CONTRACTS = new Map<string, ToolPolicyContract>();

function registerToolContract(contract: ToolPolicyContract): void {
  TOOL_CONTRACTS.set(contract.toolName, contract);
}

for (const tool of MCP_TOOLS) {
  const toolName = tool.name;
  const isClinicWide = CLINIC_WIDE_MCP_TOOLS.has(toolName);
  const isPatientScoped = PATIENT_SCOPED_MCP_TOOLS.has(toolName);
  const isNonDb = MCP_NON_DB_TOOLS.has(toolName);
  registerToolContract({
    toolName,
    allowedPurposes: isClinicWide ? ['clinical', 'operational'] : ['clinical', 'operational', 'analytics'],
    allowedScopeLevels: isPatientScoped
      ? ['patient', 'team', 'staff', 'clinic']
      : isClinicWide
        ? ['team', 'staff', 'clinic']
        : ['team', 'staff', 'clinic'],
    dataSensitivity: isNonDb ? 'low' : isClinicWide ? 'critical' : 'phi',
    // Clinic-wide operational reads should carry intent context.
    requiresJustification: isClinicWide,
  });
}

export function resolvePolicyToolAllowlist(params: {
  purposeOfUse: PurposeOfUse;
  role: string;
  scopeLevel: ScopeLevel;
}): string[] {
  const role = params.role.trim().toLowerCase();
  const isClinicianRole = role === 'clinician';

  return [...TOOL_CONTRACTS.values()]
    .filter((contract) => {
      if (!contract.allowedPurposes.includes(params.purposeOfUse)) return false;
      if (!contract.allowedScopeLevels.includes(params.scopeLevel)) return false;
      if (params.scopeLevel === 'patient' && !PATIENT_SCOPED_MCP_TOOLS.has(contract.toolName)) return false;
      if (isClinicianRole && CLINIC_WIDE_MCP_TOOLS.has(contract.toolName)) return false;
      return true;
    })
    .map((contract) => contract.toolName)
    .sort((a, b) => a.localeCompare(b));
}

export function assertToolCallAllowedByPolicy(params: {
  auth: AuthContext;
  toolName: string;
  arguments: Record<string, unknown>;
}): void {
  const contract = TOOL_CONTRACTS.get(params.toolName);
  if (!contract) {
    throw new AppError(`Unsupported MCP tool '${params.toolName}'`, 400, 'AI_TOOL_UNSUPPORTED');
  }

  const purposeOfUse = params.auth.aiPurposeOfUse ?? 'clinical';
  if (!contract.allowedPurposes.includes(purposeOfUse)) {
    throw new AppError(
      `Tool '${params.toolName}' is not allowed for purpose '${purposeOfUse}'`,
      403,
      'AI_TOOL_PURPOSE_FORBIDDEN',
    );
  }

  const scopeLevel: ScopeLevel = params.auth.aiScope?.level ?? 'clinic';
  if (scopeLevel === 'patient' && !PATIENT_SCOPED_MCP_TOOLS.has(params.toolName)) {
    throw new AppError(
      `Tool '${params.toolName}' is not allowed in patient-scoped mode`,
      403,
      'AI_TOOL_SCOPE_FORBIDDEN',
    );
  }

  if (!contract.allowedScopeLevels.includes(scopeLevel)) {
    throw new AppError(
      `Tool '${params.toolName}' is not allowed for scope '${scopeLevel}'`,
      403,
      'AI_TOOL_SCOPE_FORBIDDEN',
    );
  }

  const tokenAllowlist = params.auth.aiDecisionToken?.allowedTools;
  if (tokenAllowlist && tokenAllowlist.length > 0 && !tokenAllowlist.includes(params.toolName)) {
    throw new AppError(
      `Tool '${params.toolName}' is outside the policy decision allowlist`,
      403,
      'AI_TOOL_ALLOWLIST_FORBIDDEN',
    );
  }

  // Break-glass sessions are already audited at auth middleware.
  if (contract.requiresJustification && purposeOfUse !== 'clinical' && !params.auth.breakGlassSessionId) {
    const justificationRaw = params.arguments['justification'];
    const justification = typeof justificationRaw === 'string' ? justificationRaw.trim() : '';
    if (justification.length === 0) {
      throw new AppError(
        `Tool '${params.toolName}' requires justification for non-break-glass use`,
        422,
        'AI_TOOL_JUSTIFICATION_REQUIRED',
      );
    }
  }
}
