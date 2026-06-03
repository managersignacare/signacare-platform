import type { Knex } from 'knex';
import type { AuthContext } from '@signacare/shared';
import { assertValidDecisionToken } from '../../features/ai/policy/aiPolicy';

type ToolCallLike = {
  name: string;
  arguments: Record<string, unknown>;
};

type TeamScopeResolution = {
  ids: string[];
  names: string[];
};

const TEAM_SCOPED_TOOLS = new Set<string>([
  'team_caseload',
  'overdue_reviews',
  'medication_metrics',
  'risk_overview',
  'task_metrics',
  'waitlist_metrics',
  'referral_metrics',
]);

const TEAM_PLACEHOLDER_VALUES = new Set<string>([
  'team',
  'unit',
  'team name',
  'unit name',
  'team a',
  'team b',
  'caseload',
  'all teams',
]);

function normaliseTeamLabel(raw: string): string {
  return raw
    .trim()
    .replace(/^[\s"'([{]+/, '')
    .replace(/[\s"')\].,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalTeamLabel(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPlaceholderTeamLabel(raw: string): boolean {
  const cleaned = canonicalTeamLabel(normaliseTeamLabel(raw));
  if (!cleaned) return true;
  if (TEAM_PLACEHOLDER_VALUES.has(cleaned)) return true;
  if (/^\[[^\]]+\]$/.test(cleaned)) return true;
  return false;
}

function areStringSetsEqual(aRaw: string[] | undefined, bRaw: string[] | undefined): boolean {
  const a = new Set((aRaw ?? []).map((v) => v.trim()).filter(Boolean));
  const b = new Set((bRaw ?? []).map((v) => v.trim()).filter(Boolean));
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function assertAiDecisionTokenMatchesAuth(auth: AuthContext): void {
  if (!auth.aiPurposeOfUse && !auth.aiScope) return;
  if (!auth.aiDecisionToken) {
    throw new Error('AI policy decision token is required for scoped AI tool execution.');
  }
  assertValidDecisionToken(auth.aiDecisionToken);
  if (auth.aiDecisionToken.clinicId !== auth.clinicId || auth.aiDecisionToken.staffId !== auth.staffId) {
    throw new Error('AI decision token does not match authenticated tenant context.');
  }
  if (auth.aiDecisionToken.role !== auth.role) {
    throw new Error('AI decision token role does not match authenticated role.');
  }
  const authPermissions = (auth.permissions ?? []).map((permission) => String(permission));
  if (!areStringSetsEqual(auth.aiDecisionToken.permissions, authPermissions)) {
    throw new Error('AI decision token permission set mismatch.');
  }
  if (!areStringSetsEqual(auth.aiDecisionToken.allowedTools, auth.aiAllowedTools)) {
    throw new Error('AI decision token tool allowlist mismatch.');
  }
  if (auth.aiDecisionToken.purposeOfUse !== auth.aiPurposeOfUse) {
    throw new Error('AI decision token purpose-of-use mismatch.');
  }
  const tokenScope = auth.aiDecisionToken.scope;
  if (!!tokenScope !== !!auth.aiScope) {
    throw new Error('AI decision token scope mismatch.');
  }
  if (!tokenScope || !auth.aiScope) return;
  if (tokenScope.level !== auth.aiScope.level) {
    throw new Error('AI decision token scope level mismatch.');
  }
  if (!areStringSetsEqual(tokenScope.patientIds, auth.aiScope.patientIds)) {
    throw new Error('AI decision token patient scope mismatch.');
  }
  if (!areStringSetsEqual(tokenScope.teamIds, auth.aiScope.teamIds)) {
    throw new Error('AI decision token team scope mismatch.');
  }
  if (!areStringSetsEqual(tokenScope.staffIds, auth.aiScope.staffIds)) {
    throw new Error('AI decision token staff scope mismatch.');
  }
}

export async function enforceAiScopeForToolCall(args: {
  auth: AuthContext;
  call: ToolCallLike;
  db: Knex;
  readString: (value: unknown) => string;
  patientScopedTools: ReadonlySet<string>;
  resolveTeamScope: (teamRaw: string | undefined, clinicId: string) => Promise<TeamScopeResolution | null>;
  canonicalTeamLabel: (raw: string) => string;
  canonicalTeamBaseLabel: (raw: string) => string;
}): Promise<string | null> {
  const { auth, call, db, readString, patientScopedTools, resolveTeamScope, canonicalTeamLabel, canonicalTeamBaseLabel } = args;
  const toolArgs = call.arguments;

  if (auth.aiScope?.level === 'patient') {
    const allowedPatientIds = new Set(auth.aiScope.patientIds ?? []);
    if (allowedPatientIds.size === 0) {
      return 'Patient scope is missing patient IDs.';
    }
    if (!patientScopedTools.has(call.name)) {
      return 'This tool is not allowed in patient-scoped mode.';
    }
    const requestedPatientId = readString(toolArgs.patientId).trim();
    if (requestedPatientId.length === 0) {
      if (allowedPatientIds.size === 1) {
        toolArgs.patientId = [...allowedPatientIds][0];
      } else {
        return 'Patient-scoped request requires an explicit patient context.';
      }
    } else if (!allowedPatientIds.has(requestedPatientId)) {
      return 'Requested patient is outside the current AI scope.';
    }
  }

  if (auth.aiScope?.level === 'team') {
    const allowedTeamIds = new Set(auth.aiScope.teamIds ?? []);
    const allowedTeamLabels = new Set(
      (auth.aiScope.teamLabels ?? [])
        .map(canonicalTeamLabel)
        .filter(Boolean),
    );
    const requestedTeamRaw = readString(toolArgs.team).trim();
    const requestedTeamMissing = requestedTeamRaw.length === 0 || isPlaceholderTeamLabel(requestedTeamRaw);

    if (requestedTeamMissing && TEAM_SCOPED_TOOLS.has(call.name)) {
      const fallbackTeam = auth.aiScope.teamLabels?.[0] ?? auth.aiScope.teamIds?.[0];
      if (fallbackTeam) {
        toolArgs.team = fallbackTeam;
      } else {
        return 'Team-scoped request requires an explicit team context.';
      }
    }

    const requestedTeam = readString(toolArgs.team).trim();
    if (requestedTeam.length > 0) {
      const resolved = await resolveTeamScope(requestedTeam, auth.clinicId);
      if (!resolved || resolved.ids.length === 0) {
        return 'Requested team is invalid for this clinic scope.';
      }
      const isAllowedById = resolved.ids.some((id) => allowedTeamIds.has(id));
      const isAllowedByLabel = resolved.names
        .map(canonicalTeamLabel)
        .some((name) => allowedTeamLabels.has(name) || allowedTeamLabels.has(canonicalTeamBaseLabel(name)));
      if (!isAllowedById && !isAllowedByLabel) {
        return 'Requested team is outside the current AI scope.';
      }
    }
  }

  if (auth.aiScope?.level === 'staff') {
    const staffArg = readString(toolArgs.staffId).trim();
    if (staffArg.length > 0) {
      const staffRows = await db('staff')
        .where({ clinic_id: auth.clinicId })
        .whereNull('deleted_at')
        .andWhere((qb) => {
          qb.where('id', staffArg)
            .orWhereRaw("LOWER(TRIM(given_name || ' ' || family_name)) = LOWER(?)", [staffArg]);
        })
        .select('id', db.raw("LOWER(TRIM(given_name || ' ' || family_name)) as full_name"));
      const allowedStaffIds = new Set(auth.aiScope.staffIds ?? []);
      const allowedStaffLabels = new Set(
        (auth.aiScope.staffLabels ?? [])
          .map((name) => name.trim().toLowerCase())
          .filter(Boolean),
      );
      const inScope = staffRows.some((row) => {
        const rowId = readString((row as Record<string, unknown>)['id']);
        const fullName = readString((row as Record<string, unknown>)['full_name']).toLowerCase();
        return allowedStaffIds.has(rowId) || allowedStaffLabels.has(fullName);
      });
      if (!inScope) {
        return 'Requested staff member is outside the current AI scope.';
      }
    }
  }

  return null;
}
