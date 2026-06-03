/**
 * Signacare EMR — Model Context Protocol (MCP) Server
 *
 * Exposes clinical EMR tools to AI agents via the MCP standard.
 */
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { appPoolRaw, db, rlsStore } from '../../db/db';
import { callLocalLlm, listAvailableModels } from '../localLlmAgent';
import { loadPatientContext } from '../aiEnhancer';
import { cachedQuery } from '../../utils/queryCache';
import { logger } from '../../utils/logger';
import type { AuthContext } from '@signacare/shared';
import { AppError } from '../../shared/errors';
import { requirePatientRelationship } from '../../shared/authGuards';
import { OPEN_TASK_STATUSES } from '../../features/tasks/taskStatusCatalog';
import {
  assertAiDecisionTokenMatchesAuth,
  enforceAiScopeForToolCall,
} from './aiScopeEnforcement';
import { assertToolCallAllowedByPolicy } from '../../features/ai/tools/toolPolicy';
import {
  CLINIC_WIDE_MCP_TOOLS,
  MCP_NON_DB_TOOLS,
  PATIENT_SCOPED_MCP_TOOLS,
  MCP_TOOLS,
} from './mcpToolCatalog';
import { mapSequential } from './mcpCollection';
import { writeToolAuditNonBlocking } from './mcpAudit';

// Knex .count('* as cnt') returns a row shape that's typed as `any`
// by @types/knex (drivers emit either number or string). This local
// alias captures the actual shape so consumers access `.cnt` through
// a typed reference instead of casting to any at every site.
interface CountRow { cnt: number | string }
const asCount = (r: unknown): number => {
  const cnt = (r as CountRow | undefined)?.cnt;
  return typeof cnt === 'number' ? cnt : typeof cnt === 'string' ? parseInt(cnt, 10) || 0 : 0;
};

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}

type McpRow = Record<string, unknown>;

const asRow = (value: unknown): McpRow => (
  value != null && typeof value === 'object' ? (value as McpRow) : {}
);

const readString = (value: unknown, fallback = ''): string => (
  typeof value === 'string' ? value : value == null ? fallback : String(value)
);

const readOptionalString = (value: unknown): string | null => (
  value == null ? null : typeof value === 'string' ? value : String(value)
);

const readDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface McpToolCall { name: string; arguments: Record<string, string | undefined>; }
interface McpToolResult { content: { type: 'text'; text: string }[]; isError?: boolean; }

// BUG-741 — when MCP tools run outside request-ALS, bootstrap a short RLS
// transaction (app.clinic_id/app.user_id) for DB-backed tools.

// ============ Helpers ============

function periodRange(period?: string): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  let from: Date;
  switch (period) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week': {
      const day = now.getDay();
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1));
      break;
    }
    case 'quarter':
      from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      break;
    case 'month':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }
  return { from, to };
}

// ============ Name Resolution Helpers ============

/** Cache org-unit UUID → name mapping per clinic */
const orgUnitMapByClinic = new Map<string, Record<string, string>>();
async function getOrgUnitMap(clinicId: string): Promise<Record<string, string>> {
  const cached = orgUnitMapByClinic.get(clinicId);
  if (cached) return cached;
  const rows = await db('org_units')
    .where({ clinic_id: clinicId })
    .select('id', 'name')
    .catch((err) => { logger.warn({ err, clinicId }, 'MCP: org_units lookup failed — tool results will show UUIDs instead of names'); return []; });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.name;
  orgUnitMapByClinic.set(clinicId, map);
  return map;
}

/** Resolve a team value — if it's a UUID, look up the name; otherwise return as-is */
async function resolveTeamName(team: string | null, clinicId: string): Promise<string> {
  if (!team) return 'Unassigned';
  const isUuid = UUID_RE.test(team);
  if (!isUuid) return team;
  const map = await getOrgUnitMap(clinicId);
  return map[team] ?? team;
}

/** Resolve a staff UUID to "Given Family" */
async function resolveStaffName(staffId: string | null, clinicId: string): Promise<string> {
  if (!staffId) return 'Unassigned';
  const row = await db('staff')
    .where({ id: staffId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('given_name', 'family_name')
    .first()
    .catch((err) => { logger.warn({ err, clinicId, staffId }, 'mcpServer: op failed — returning null'); return null; });
  return row ? `${row.given_name} ${row.family_name}` : staffId;
}

/** Resolve a patient UUID to "Given Family (MRN)" */
async function resolvePatientName(patientId: string | null, clinicId: string): Promise<string> {
  if (!patientId) return 'Unknown';
  const row = await db('patients')
    .where({ id: patientId, clinic_id: clinicId })
    .whereNull('deleted_at')
    .select('given_name', 'family_name', 'emr_number')
    .first()
    .catch((err) => { logger.warn({ err, clinicId, patientId }, 'mcpServer: op failed — returning null'); return null; });
  return row ? `${row.given_name} ${row.family_name} (${row.emr_number})` : patientId;
}

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

interface TeamScope {
  requested: string;
  ids: string[];
  names: string[];
  label: string;
}

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

function canonicalTeamBaseLabel(raw: string): string {
  return canonicalTeamLabel(raw.replace(/\s*\([^)]*\)\s*/g, ' '));
}

function isPlaceholderTeamLabel(raw: string): boolean {
  const cleaned = canonicalTeamLabel(normaliseTeamLabel(raw));
  if (!cleaned) return true;
  if (TEAM_PLACEHOLDER_VALUES.has(cleaned)) return true;
  if (/^\[[^\]]+\]$/.test(cleaned)) return true;
  return false;
}

async function resolveTeamScope(teamRaw: string | undefined, clinicId: string): Promise<TeamScope | null> {
  const requested = normaliseTeamLabel(readString(teamRaw));
  if (!requested) return null;
  if (isPlaceholderTeamLabel(requested)) {
    return {
      requested,
      ids: [],
      names: [],
      label: requested,
    };
  }

  const orgMap = await getOrgUnitMap(clinicId);
  const entries = Object.entries(orgMap);
  if (UUID_RE.test(requested)) {
    return {
      requested,
      ids: [requested],
      names: orgMap[requested] ? [orgMap[requested]] : [requested],
      label: orgMap[requested] ?? requested,
    };
  }

  const requestedCanonical = canonicalTeamLabel(requested);
  const requestedBase = canonicalTeamBaseLabel(requested);

  let matches = entries.filter(([, name]) => {
    const c = canonicalTeamLabel(name);
    const b = canonicalTeamBaseLabel(name);
    return c === requestedCanonical || b === requestedCanonical || c === requestedBase || b === requestedBase;
  });

  if (matches.length === 0) {
    matches = entries.filter(([, name]) => {
      const c = canonicalTeamLabel(name);
      const b = canonicalTeamBaseLabel(name);
      return c.includes(requestedCanonical) || b.includes(requestedCanonical) || requestedCanonical.includes(b);
    });
  }

  const ids = Array.from(new Set(matches.map(([id]) => id)));
  const names = Array.from(new Set(matches.map(([, name]) => name)));
  return {
    requested,
    ids,
    names,
    label: names.length === 1 ? names[0] : requested,
  };
}

function applyTeamScopeFilter(query: Knex.QueryBuilder, column: string, scope: TeamScope): void {
  if (scope.ids.length === 1) {
    query.where(column, scope.ids[0]);
    return;
  }
  if (scope.ids.length > 1) {
    query.whereIn(column, scope.ids);
    return;
  }
  query.whereRaw('1 = 0');
}

async function withTenantContextIfMissing<T>(
  auth: AuthContext,
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (MCP_NON_DB_TOOLS.has(toolName) || rlsStore.getStore()) {
    return fn();
  }
  return appPoolRaw.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [auth.clinicId]);
    await trx.raw("SELECT set_config('app.user_id', ?, true)", [auth.staffId]);
    await trx.raw("SET LOCAL statement_timeout = '30s'");
    return rlsStore.run(trx, fn);
  });
}

// ============ Tool Handlers ============

export async function handleToolCall(call: McpToolCall, auth: AuthContext): Promise<McpToolResult> {
  try {
    return await withTenantContextIfMissing(auth, call.name, async () => {
      try {
        assertAiDecisionTokenMatchesAuth(auth);
      } catch (err) {
        logger.warn({
          clinicId: auth.clinicId,
          staffId: auth.staffId,
          tool: call.name,
          err,
        }, 'AI policy token verification failed for MCP tool call');
        await writeToolAuditNonBlocking({
          auth,
          toolName: call.name,
          argumentsSummary: { argumentKeys: Object.keys(call.arguments ?? {}) },
          success: false,
          errorCode: 'AI_POLICY_TOKEN_INVALID',
        });
        return error('AI policy verification failed for this request scope.');
      }
      const a = call.arguments;
      try {
        assertToolCallAllowedByPolicy({
          auth,
          toolName: call.name,
          arguments: a as Record<string, unknown>,
        });
      } catch (err) {
        const code = err instanceof AppError ? err.code : 'AI_TOOL_POLICY_FORBIDDEN';
        await writeToolAuditNonBlocking({
          auth,
          toolName: call.name,
          argumentsSummary: { argumentKeys: Object.keys(a ?? {}) },
          success: false,
          errorCode: code,
        });
        return error(err instanceof Error ? err.message : 'Tool call blocked by AI policy.');
      }

      const role = String(auth.role ?? '').toLowerCase();
      const scopeError = await enforceAiScopeForToolCall({
        auth,
        call,
        db,
        readString,
        patientScopedTools: PATIENT_SCOPED_MCP_TOOLS,
        resolveTeamScope,
        canonicalTeamLabel,
        canonicalTeamBaseLabel,
      });
      if (scopeError) {
        await writeToolAuditNonBlocking({
          auth,
          toolName: call.name,
          argumentsSummary: { argumentKeys: Object.keys(a ?? {}) },
          success: false,
          errorCode: 'AI_SCOPE_FORBIDDEN',
        });
        return error(scopeError);
      }

      if (role === 'clinician' && CLINIC_WIDE_MCP_TOOLS.has(call.name)) {
        await writeToolAuditNonBlocking({
          auth,
          toolName: call.name,
          argumentsSummary: { argumentKeys: Object.keys(a ?? {}) },
          success: false,
          errorCode: 'AI_TOOL_ROLE_FORBIDDEN',
        });
        return error('This analytics tool requires admin-level access. Use patient-scoped tools for clinician workflows.');
      }
      if (role === 'clinician' && call.name === 'list_legal_orders' && !readString(a?.patientId)) {
        await writeToolAuditNonBlocking({
          auth,
          toolName: call.name,
          argumentsSummary: { argumentKeys: Object.keys(a ?? {}) },
          success: false,
          errorCode: 'AI_TOOL_PATIENT_CONTEXT_REQUIRED',
        });
        return error('Clinicians must provide a patient context for legal-order queries.');
      }

      // BUG-281 — gate every tool call that reads patient-scoped data on
      // requirePatientRelationship. Tools without a.patientId (e.g.
      // search_patients, list-by-clinic aggregates) are NOT gated here
      // because they're intentionally clinic-wide; the upstream
      // requireRole + tenant middleware handle the clinic bounds.
      if (typeof a?.patientId === 'string' && a.patientId.length > 0) {
        await requirePatientRelationship(auth, a.patientId);
      }

      switch (call.name) {
      case 'search_patients': {
        const query = readString(a.query);
        const rows = await db('patients')
          .where({ clinic_id: auth.clinicId })
          .where(function () { this.whereILike('given_name', `%${escapeLike(query)}%`).orWhereILike('family_name', `%${escapeLike(query)}%`).orWhereILike('emr_number', `%${escapeLike(query)}%`); })
          .whereNull('deleted_at').limit(parseInt(readString(a.limit), 10) || 10)
          .select('id', 'given_name', 'family_name', 'date_of_birth', 'emr_number', 'gender');
        return text(JSON.stringify(rows.map((r) => {
          const row = asRow(r);
          return {
            id: row.id,
            name: `${readString(row.given_name)} ${readString(row.family_name)}`.trim(),
            dob: row.date_of_birth,
            ur: row.emr_number,
            gender: row.gender,
          };
        }), null, 2));
      }
      case 'get_patient': {
        const row = await db('patients')
          .where({ id: readString(a.patientId), clinic_id: auth.clinicId })
          .whereNull('deleted_at')
          .first();
        return row ? text(JSON.stringify(row, null, 2)) : error('Patient not found');
      }
      case 'get_patient_context': {
        // BUG-281 — AuthContext-gated. `a.clinicId` param removed
        // because the guard enforces auth.clinicId tenant scope.
        const ctx = await loadPatientContext(auth, readString(a.patientId));
        return text(ctx || 'No context available.');
      }
      case 'list_medications': {
        const q = db('patient_medications')
          .where({ clinic_id: auth.clinicId, patient_id: readString(a.patientId) })
          .whereNull('deleted_at')
          .orderBy('created_at', 'desc')
          .limit(500); // BUG-437 — unbounded-ceiling per-patient meds
        if (a.status && a.status !== 'all') q.where('status', a.status);
        const rows = await q;
        return text(rows.map((r) => {
          const row = asRow(r);
          return `${readString(row.medication_name)} ${readString(row.dose)} ${readString(row.frequency)} (${readString(row.route)}) — ${readString(row.status)}${row.is_lai ? ' [LAI]' : ''}${row.is_s8 ? ' [S8]' : ''}${row.is_clozapine ? ' [Cloz]' : ''}`;
        }).join('\n') || 'No medications.');
      }
      case 'list_notes': {
        const rows = await db('clinical_notes')
          .where({ clinic_id: auth.clinicId, patient_id: readString(a.patientId) })
          .whereNull('deleted_at')
          .orderBy('created_at', 'desc').limit(parseInt(readString(a.limit), 10) || 20)
          .select('id', 'title', 'note_type', 'status', 'created_at', db.raw("LEFT(content, 300) as preview"));
        return text(rows.map((r) => {
          const row = asRow(r);
          const createdAt = readDate(row.created_at);
          const preview = readString(row.preview).replace(/<[^>]*>/g, '').substring(0, 200);
          return `[${createdAt ? createdAt.toLocaleDateString('en-AU') : '?'}] ${readString(row.note_type, readString(row.title, 'Note'))} (${readString(row.status, 'draft')}): ${preview}`;
        }).join('\n\n') || 'No notes.');
      }
      case 'create_note': {
        const id = randomUUID();
        await db('clinical_notes').insert({
          id,
          clinic_id: auth.clinicId,
          patient_id: a.patientId,
          author_id: auth.staffId ?? a.authorId ?? null,
          title: a.title || 'AI Agent Note', note_type: a.category || 'progress', content: a.content,
          status: 'draft',
          created_at: new Date(), updated_at: new Date(),
        });
        return text(`Note created (draft): ${id}`);
      }
      case 'list_alerts': {
        const rows = await db('patient_alerts')
          .where({ clinic_id: auth.clinicId, patient_id: readString(a.patientId), is_active: true })
          .limit(500); // BUG-437 — unbounded-ceiling per-patient alerts
        return text(rows.map((r) => {
          const row = asRow(r);
          return `[${readString(row.severity)}] ${readString(row.title)}: ${readString(row.notes).substring(0, 200)}`;
        }).join('\n') || 'No active alerts.');
      }
      case 'generate_clinical_document': {
        const { clinicalAi } = await import('../localLlmAgent');
        const fns: Record<string, (d: string, m?: string) => Promise<string>> = {
          maudsley: clinicalAi.generateMaudsleySummary, isbar: clinicalAi.generateISBAR,
          formulation: clinicalAi.generateFormulation, '91day': clinicalAi.generate91DayReview,
          letter: (d, m) => clinicalAi.generateLetter(d, 'GP letter', m),
          discharge: clinicalAi.generateDischargeSummary, 'med-summary': clinicalAi.generateMedSummary,
          ambient: clinicalAi.processAmbientNotes,
        };
        const action = readString(a.action);
        const fn = fns[action];
        return fn ? text(await fn(readString(a.data), a.model)) : error(`Unknown action: ${action}`);
      }
      case 'classify_text': {
        const r = await callLocalLlm({ prompt: readString(a.text), model: 'mentalbert' });
        return text(r.text);
      }
      case 'list_models': {
        const models = await listAvailableModels();
        return text(models.map(m => `${m.name} (${m.ollamaModel}) — ${m.type}${m.available ? ' ✓' : ' ✗'}: ${m.description.substring(0, 80)}`).join('\n'));
      }
      case 'search_drug_interactions': {
        const drugs = readString(a.drugs).split(',').map((d: string) => d.trim()).filter(Boolean);
        const rxcuis: string[] = [];
        for (const drug of drugs) {
          try {
            const r = await fetch(
              `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(drug)}&search=2`,
              { signal: AbortSignal.timeout(10_000) },
            );
            if (!r.ok) continue;
            const d = (await r.json()) as { idGroup?: { rxnormId?: string[] } };
            if (d?.idGroup?.rxnormId?.length) rxcuis.push(d.idGroup.rxnormId[0]);
          } catch {
            continue;
          }
        }
        if (rxcuis.length < 2) return text('Need at least 2 valid drugs to check.');
        let data: {
          fullInteractionTypeGroup?: Array<{
            fullInteractionType?: Array<{
              interactionPair?: Array<{
                interactionConcept?: Array<{ minConceptItem?: { name?: string } }>;
                description?: string;
                severity?: string;
              }>;
            }>;
          }>;
        } | null = null;
        try {
          const resp = await fetch(
            `https://rxnav.nlm.nih.gov/REST/interaction/list.json?rxcuis=${rxcuis.join('+')}`,
            { signal: AbortSignal.timeout(12_000) },
          );
          if (!resp.ok) {
            return text('Drug interaction service is temporarily unavailable. Please retry shortly.');
          }
          data = (await resp.json()) as {
            fullInteractionTypeGroup?: Array<{
              fullInteractionType?: Array<{
                interactionPair?: Array<{
                  interactionConcept?: Array<{ minConceptItem?: { name?: string } }>;
                  description?: string;
                  severity?: string;
                }>;
              }>;
            }>;
          };
        } catch {
          return text('Drug interaction service timed out. Please retry shortly.');
        }
        const ixns: string[] = [];
        for (const g of data?.fullInteractionTypeGroup ?? []) for (const t of g.fullInteractionType ?? []) for (const p of t.interactionPair ?? [])
          ixns.push(`${(p.interactionConcept ?? []).map((c) => c.minConceptItem?.name).filter(Boolean).join(' ↔ ')}: ${readString(p.description)} (${readString(p.severity)})`);
        return text(ixns.join('\n\n') || 'No interactions found.');
      }
      case 'list_episodes': {
        const q = db('episodes')
          .where({ clinic_id: auth.clinicId, patient_id: readString(a.patientId) })
          .whereNull('deleted_at')
          .orderBy('start_date', 'desc')
          .limit(500); // BUG-437 — unbounded-ceiling per-patient episodes
        if (a.status && a.status !== 'all') q.where('status', a.status);
        const rows = await q;
        return text(rows.map((r) => {
          const row = asRow(r);
          return `${readString(row.episode_type)} — ${readString(row.primary_diagnosis, 'No dx')} (${readString(row.status)}, ${readString(row.team_id)}, started ${readString(row.start_date)})`;
        }).join('\n') || 'No episodes.');
      }

      // ── Team / Org / Staff level ──
      case 'team_caseload': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (!teamScope || teamScope.ids.length === 0) {
          return error(`Team not found: ${readString(a.team)}. Please use a valid team or unit name.`);
        }
        const teamPatients = await db('episodes')
          .where({ 'episodes.clinic_id': auth.clinicId, 'episodes.status': 'open' })
          .whereNull('episodes.deleted_at')
          .whereIn('episodes.team_id', teamScope.ids)
          .join('patients', 'episodes.patient_id', 'patients.id')
          .select('patients.id', 'patients.given_name', 'patients.family_name', 'patients.emr_number', 'episodes.primary_diagnosis', 'episodes.episode_type', 'episodes.start_date', 'episodes.primary_clinician_id');
        const medCounts = await db('patient_medications')
          .where({ clinic_id: auth.clinicId })
          .whereIn('patient_id', teamPatients.map((p) => asRow(p).id as string))
          .where('status', 'active')
          .whereNull('deleted_at')
          .count('* as cnt');
        const patientLines = await mapSequential(teamPatients, async (p) => {
          const row = asRow(p);
          const clinician = row.primary_clinician_id ? await resolveStaffName(readString(row.primary_clinician_id), auth.clinicId) : 'Unassigned';
          return `• ${readString(row.given_name)} ${readString(row.family_name)} (${readString(row.emr_number)}) — ${readString(row.primary_diagnosis, 'No dx')} (${readString(row.episode_type)}, since ${readString(row.start_date)}) [Clinician: ${clinician}]`;
        });
        return text(`Team ${teamScope.label} Caseload:\nPatients: ${teamPatients.length}\n\n${patientLines.join('\n')}\n\nActive medications across team: ${asCount(medCounts[0])}`);
      }
      case 'org_statistics': {
        const orgData = await cachedQuery(`mcp:org_statistics:v2:${auth.clinicId}`, 30, async () => {
          const [patients] = await db('patients').where({ clinic_id: auth.clinicId }).whereNull('deleted_at').count('* as cnt');
          const [episodes] = await db('episodes').where({ clinic_id: auth.clinicId, status: 'open' }).whereNull('deleted_at').count('* as cnt');
          const [caseloadPatients] = await db('episodes')
            .where({ clinic_id: auth.clinicId, status: 'open' })
            .whereNull('deleted_at')
            .countDistinct('patient_id as cnt');
          const [staff] = await db('staff').where({ clinic_id: auth.clinicId }).whereNull('deleted_at').where('is_active', true).count('* as cnt');
          const [meds] = await db('patient_medications').where({ clinic_id: auth.clinicId, status: 'active' }).whereNull('deleted_at').count('* as cnt');
          const [alerts] = await db('patient_alerts').where({ clinic_id: auth.clinicId, is_active: true }).count('* as cnt');
          const [notes] = await db('clinical_notes').where({ clinic_id: auth.clinicId }).whereNull('deleted_at').count('* as cnt');
          const [legalActive] = await db('patient_legal_orders').where({ clinic_id: auth.clinicId, status: 'active' }).count('* as cnt');
          const teams = await db('episodes')
            .where({ clinic_id: auth.clinicId, status: 'open' })
            .whereNull('deleted_at')
            .whereNotNull('team_id')
            .groupBy('team_id')
            .select('team_id', db.raw('count(*) as cnt'));
          return { patients, episodes, caseloadPatients, staff, meds, alerts, notes, legalActive, teams };
        });
        const { patients, episodes, caseloadPatients, staff, meds, alerts, notes, legalActive, teams } = orgData;
        const resolvedTeams = await mapSequential(teams, async (t: { team_id: string; cnt: number | string }) => {
          const name = await resolveTeamName(t.team_id, auth.clinicId);
          return `  ${name}: ${t.cnt} patients`;
        });
        const teamLines = resolvedTeams.join('\n');
        const totalPatients = Math.max(asCount(patients), asCount(caseloadPatients));
        return text(`Organisation Statistics:\n• Total Patients: ${totalPatients}\n• Patients in Active Caseload: ${asCount(caseloadPatients)}\n• Open Episodes: ${asCount(episodes)}\n• Active Staff: ${asCount(staff)}\n• Active Medications: ${asCount(meds)}\n• Active Alerts: ${asCount(alerts)}\n• Total Notes: ${asCount(notes)}\n• Active Legal Orders: ${asCount(legalActive)}\n\nTeam Breakdown:\n${teamLines}`);
      }
      case 'staff_workload': {
        // Try to find by ID or name — always try name search if not a valid UUID
        let staffRow: McpRow | null = null;
        const staffIdInput = readString(a.staffId);
        const isUuid = UUID_RE.test(staffIdInput);
        if (isUuid) {
          const raw = await db('staff').where({ id: staffIdInput, clinic_id: auth.clinicId }).whereNull('deleted_at').first();
          staffRow = raw ? asRow(raw) : null;
        }
        if (!staffRow) {
          // Search by name — strip common prefixes
          const searchName = staffIdInput.replace(/^(workload|staff|for|the|dr|dr\.|doctor|nurse|show|get|what is)\s+/gi, '').trim();
          if (!searchName) {
            return error('Please provide a staff member name, e.g. "Staff workload for Jane Smith".');
          }
          const parts = searchName.split(/\s+/);
          const q = db('staff').where({ clinic_id: auth.clinicId }).whereNull('deleted_at');
          if (parts.length >= 2) {
            q.where(function() {
              this.whereILike('given_name', `%${escapeLike(parts[0])}%`).whereILike('family_name', `%${escapeLike(parts[parts.length - 1])}%`);
            }).orWhere(function() {
              this.whereILike('given_name', `%${escapeLike(parts[parts.length - 1])}%`).whereILike('family_name', `%${escapeLike(parts[0])}%`);
            });
          } else {
            q.where(function() {
              this.whereILike('given_name', `%${escapeLike(searchName)}%`).orWhereILike('family_name', `%${escapeLike(searchName)}%`);
            });
          }
          const raw = await q.first();
          staffRow = raw ? asRow(raw) : null;
        }
        if (!staffRow) return error(`Staff not found: ${staffIdInput}. Try using a staff member's first or last name.`);
        const staffRowId = readString(staffRow.id);
        const epCount = await db('episodes').where({ clinic_id: auth.clinicId, primary_clinician_id: staffRowId, status: 'open' }).whereNull('deleted_at').count('* as cnt');
        const apptCount = await db('appointments').where({ clinic_id: auth.clinicId, clinician_id: staffRowId, status: 'scheduled' }).whereNull('deleted_at').count('* as cnt');
        const noteCount = await db('clinical_notes').where({ clinic_id: auth.clinicId, author_id: staffRowId, status: 'draft' }).whereNull('deleted_at').count('* as cnt');
        // Get actual patient list
        const staffPatients = await db('episodes').where({ 'episodes.clinic_id': auth.clinicId, 'episodes.primary_clinician_id': staffRowId, 'episodes.status': 'open' }).whereNull('episodes.deleted_at')
          .join('patients', 'episodes.patient_id', 'patients.id')
          .select('patients.given_name', 'patients.family_name', 'patients.emr_number', 'episodes.team_id', 'episodes.primary_diagnosis');
        const patientListLines = await mapSequential(staffPatients, async (p) => {
          const row = asRow(p);
          const teamName = await resolveTeamName(readOptionalString(row.team_id), auth.clinicId);
          return `  - ${readString(row.given_name)} ${readString(row.family_name)} (${readString(row.emr_number)}) — ${teamName} — ${readString(row.primary_diagnosis, 'No dx')}`;
        });
        return text(`Staff: ${readString(staffRow.given_name)} ${readString(staffRow.family_name)} (${readString(staffRow.role)})\n• Active patients (primary clinician): ${asCount(epCount[0])}\n• Upcoming appointments: ${asCount(apptCount[0])}\n• Pending draft notes: ${asCount(noteCount[0])}\n\nPatient List:\n${patientListLines.join('\n') || '  None'}`);
      }
      case 'list_staff': {
        const rows = await db('staff')
          .where({ clinic_id: auth.clinicId })
          .whereNull('deleted_at')
          .where('is_active', true)
          .select('id', 'given_name', 'family_name', 'role', 'discipline_id')
          .orderBy('family_name');
        return text(rows.map((r) => {
          const row = asRow(r);
          const discipline = readString(row.discipline_id);
          return `${readString(row.given_name)} ${readString(row.family_name)} — ${readString(row.role)}${discipline ? ` (${discipline})` : ''}`;
        }).join('\n'));
      }
      case 'overdue_reviews': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const q = db('episodes')
          .where({ 'episodes.clinic_id': auth.clinicId, 'episodes.status': 'open' })
          .whereNull('episodes.deleted_at')
          .whereNotNull('episodes.start_date')
          .join('patients', 'episodes.patient_id', 'patients.id')
          .select('patients.given_name', 'patients.family_name', 'patients.emr_number', 'episodes.team_id', 'episodes.start_date', 'episodes.primary_diagnosis', 'episodes.primary_clinician_id');
        if (teamScope) applyTeamScopeFilter(q, 'episodes.team_id', teamScope);
        const rows = await q;
        const overdue = rows.filter((r) => {
          const row = asRow(r);
          const start = readDate(row.start_date);
          if (!start) return false;
          const daysSince = Math.ceil((Date.now() - start.getTime()) / 86400000);
          return daysSince > 91;
        });
        const overdueLines = await mapSequential(overdue, async (r) => {
          const row = asRow(r);
          const start = readDate(row.start_date);
          const days = start ? Math.ceil((Date.now() - start.getTime()) / 86400000) : 0;
          const teamName = await resolveTeamName(readOptionalString(row.team_id), auth.clinicId);
          const clinician = await resolveStaffName(readOptionalString(row.primary_clinician_id), auth.clinicId);
          return `• ${readString(row.given_name)} ${readString(row.family_name)} (${readString(row.emr_number)}) — ${teamName} — ${days} days overdue — ${readString(row.primary_diagnosis, 'No dx')} [Clinician: ${clinician}]`;
        });
        return text(`Overdue 91-Day Reviews${teamScope ? ` (${teamScope.label})` : ''} — ${overdue.length} found:\n${overdueLines.join('\n') || 'No overdue reviews.'}`);
      }
      case 'list_legal_orders': {
        const q = db('patient_legal_orders')
          .where({ 'patient_legal_orders.clinic_id': auth.clinicId })
          .whereIn('status', ['active', 'pending'])
          .join('patients', 'patient_legal_orders.patient_id', 'patients.id')
          .join('legal_order_type_configs', 'patient_legal_orders.order_type_id', 'legal_order_type_configs.id')
          .select('patients.given_name', 'patients.family_name', 'legal_order_type_configs.name as order_type', 'patient_legal_orders.status', 'patient_legal_orders.start_date', 'patient_legal_orders.end_date', 'patient_legal_orders.review_date');
        if (a.patientId) q.where('patient_legal_orders.patient_id', a.patientId);
        const rows = await q;
        return text(rows.map((r) => {
          const row = asRow(r);
          return `${readString(row.given_name)} ${readString(row.family_name)}: ${readString(row.order_type)} (${readString(row.status)}) — ${readString(row.start_date)} to ${readString(row.end_date, 'ongoing')}, review: ${readString(row.review_date, 'N/A')}`;
        }).join('\n') || 'No active legal orders.');
      }
      // ── Manager Metrics Implementations ──

      case 'referral_metrics': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const { from, to } = periodRange(a.period);
        const q = db('referrals')
          .where({ clinic_id: auth.clinicId })
          .whereBetween('created_at', [from, to])
          .whereNull('deleted_at');
        if (teamScope) {
          q.whereIn(
            'patient_id',
            db('episodes')
              .where({ clinic_id: auth.clinicId, status: 'open' })
              .whereIn('team_id', teamScope.ids)
              .whereNull('deleted_at')
              .select('patient_id'),
          );
        }
        const [total] = await q.clone().count('* as cnt');
        const [accepted] = await q.clone().where('status', 'accepted').count('* as cnt');
        const [declined] = await q.clone().where('status', 'declined').count('* as cnt');
        const [pending] = await q.clone().whereIn('status', ['received', 'under_review']).count('* as cnt');
        const [sla] = await q.clone().whereNotNull('sla_due_date').select(
          db.raw(`COUNT(*) FILTER (WHERE updated_at <= sla_due_date OR sla_due_date IS NULL) as within_sla`),
          db.raw(`COUNT(*) as total_with_sla`),
          db.raw(`AVG(EXTRACT(EPOCH FROM (COALESCE(accepted_at, updated_at) - created_at)) / 86400)::numeric(5,1) as avg_days`)
        );
        // sla is a raw select with computed columns — not a simple count row.
        const slaRow = sla as { within_sla?: number | string; total_with_sla?: number | string; avg_days?: number | string | null } | undefined;
        const totalWithSla = Number(slaRow?.total_with_sla ?? 0);
        const withinSla = Number(slaRow?.within_sla ?? 0);
        return text(`## Referral Metrics${teamScope ? ` — ${teamScope.label}` : ''} (${a.period ?? 'month'})\n• Total Received: ${asCount(total)}\n• Accepted: ${asCount(accepted)}\n• Declined: ${asCount(declined)}\n• Pending Review: ${asCount(pending)}\n• SLA Compliance: ${totalWithSla > 0 ? Math.round((withinSla / totalWithSla) * 100) : 'N/A'}%\n• Avg Days to First Contact: ${slaRow?.avg_days ?? 'N/A'}`);
      }

      case 'appointment_metrics': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const { from, to } = periodRange(a.period);
        const q = db('appointments')
          .where({ clinic_id: auth.clinicId })
          .whereBetween('appointment_start', [from, to])
          .whereNull('deleted_at');
        if (teamScope) {
          q.whereIn(
            'patient_id',
            db('episodes')
              .where({ clinic_id: auth.clinicId, status: 'open' })
              .whereIn('team_id', teamScope.ids)
              .whereNull('deleted_at')
              .select('patient_id'),
          );
        }
        const [total] = await q.clone().count('* as cnt');
        const [completed] = await q.clone().where('status', 'completed').count('* as cnt');
        const [noShow] = await q.clone().where('status', 'no_show').count('* as cnt');
        const [cancelled] = await q.clone().where('status', 'cancelled').count('* as cnt');
        const [telehealth] = await q.clone().where('telehealth', true).count('* as cnt');
        const totalCount = asCount(total);
        const completedCount = asCount(completed);
        const noShowCount = asCount(noShow);
        const cancelledCount = asCount(cancelled);
        const telehealthCount = asCount(telehealth);
        const t = totalCount || 1;
        return text(`## Appointment Metrics${teamScope ? ` — ${teamScope.label}` : ''} (${a.period ?? 'month'})\n• Total Scheduled: ${totalCount}\n• Completed: ${completedCount}\n• DNA / No-Show: ${noShowCount} (${Math.round(noShowCount / t * 100)}%)\n• Cancelled: ${cancelledCount} (${Math.round(cancelledCount / t * 100)}%)\n• Telehealth: ${telehealthCount} (${Math.round(telehealthCount / t * 100)}%)`);
      }

      case 'clinical_activity': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const { from, to } = periodRange(a.period);
        const q = db('clinical_notes')
          .where({ clinic_id: auth.clinicId })
          .whereBetween('created_at', [from, to])
          .whereNull('deleted_at');
        if (teamScope) {
          q.whereIn(
            'patient_id',
            db('episodes')
              .where({ clinic_id: auth.clinicId, status: 'open' })
              .whereIn('team_id', teamScope.ids)
              .whereNull('deleted_at')
              .select('patient_id'),
          );
        }
        const [total] = await q.clone().count('* as cnt');
        const [signed] = await q.clone().where('status', 'signed').count('* as cnt');
        const [draft] = await q.clone().where('status', 'draft').count('* as cnt');
        // Notes per clinician
        const perClinician = await q.clone().whereNotNull('author_id')
          .join('staff', 'clinical_notes.author_id', 'staff.id')
          .groupBy('staff.id', 'staff.given_name', 'staff.family_name')
          .select('staff.given_name', 'staff.family_name', db.raw('COUNT(*) as cnt'))
          .orderBy('cnt', 'desc').limit(10);
        const clinicianBreakdown = perClinician.map((r) => {
          const row = asRow(r);
          return `  ${readString(row.given_name)} ${readString(row.family_name)}: ${readString(row.cnt)}`;
        }).join('\n');
        return text(`## Clinical Activity / ABF Contacts${teamScope ? ` — ${teamScope.label}` : ''} (${a.period ?? 'month'})\n• Total Notes Written: ${asCount(total)}\n• Signed (finalised): ${asCount(signed)}\n• Draft (unsigned): ${asCount(draft)}\n\nNotes per Clinician:\n${clinicianBreakdown || '  No data'}`);
      }

      case 'bed_occupancy': {
        const [totalBeds] = await db('beds').where({ clinic_id: auth.clinicId }).count('* as cnt');
        const [occupied] = await db('beds').where({ clinic_id: auth.clinicId, status: 'occupied' }).count('* as cnt');
        const totalB = asCount(totalBeds);
        const occB = asCount(occupied);
        // Avg LOS for current inpatients
        const [avgLos] = await db('episodes')
          .where({ clinic_id: auth.clinicId, status: 'open', episode_type: 'inpatient' })
          .whereNull('deleted_at')
          .select(db.raw(`AVG(CURRENT_DATE - start_date)::numeric(5,1) as avg_days`));
        const avgLosDays = (avgLos as { avg_days?: number | string | null } | undefined)?.avg_days;
        return text(`## Bed Occupancy\n• Total Beds: ${totalB}\n• Occupied: ${occB}\n• Available: ${totalB - occB}\n• Occupancy Rate: ${totalB > 0 ? Math.round(occB / totalB * 100) : 0}%\n• Avg Length of Stay (current inpatients): ${avgLosDays ?? 'N/A'} days`);
      }

      case 'discharge_metrics': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const { from, to } = periodRange(a.period);
        // PR-R1-13 DRAIN (2026-05-01): closed_at → end_date (episodes table
        // has no closed_at; end_date is the discharge timestamp, consistent
        // with line 462's LOS calc `AVG(end_date - start_date)`).
        const q = db('episodes')
          .where({ clinic_id: auth.clinicId })
          .whereNull('deleted_at')
          .whereNotNull('end_date')
          .whereBetween('end_date', [from, to]);
        if (teamScope) applyTeamScopeFilter(q, 'team_id', teamScope);
        const [total] = await q.clone().count('* as cnt');
        const [avgLen] = await q.clone().select(db.raw(`AVG(end_date - start_date)::numeric(5,1) as avg_days`));
        const reasons = await q.clone().whereNotNull('closure_reason').groupBy('closure_reason')
          .select('closure_reason', db.raw('COUNT(*) as cnt')).orderBy('cnt', 'desc');
        const reasonLines = reasons.map((r) => {
          const row = asRow(r);
          return `  ${readString(row.closure_reason)}: ${readString(row.cnt)}`;
        }).join('\n');
        const avgLenDays = (avgLen as { avg_days?: number | string | null } | undefined)?.avg_days;
        return text(`## Discharge Metrics${teamScope ? ` — ${teamScope.label}` : ''} (${a.period ?? 'month'})\n• Episodes Closed: ${asCount(total)}\n• Avg Episode Length: ${avgLenDays ?? 'N/A'} days\n\nClosure Reasons:\n${reasonLines || '  No data'}`);
      }

      case 'waitlist_metrics': {
        const rows = await db('waitlist_entries')
          .where({ clinic_id: auth.clinicId, status: 'waiting' })
          .whereNull('deleted_at')
          .limit(2000)
          .select('*'); // BUG-437 — unbounded-ceiling clinic-wide waitlist scan; SQL-aggregation refactor is BUG-440
        const total = rows.length;
        const avgWait = total > 0 ? Math.round(rows.reduce((s: number, r) => {
          const createdAt = readDate(asRow(r).created_at);
          const ageDays = createdAt ? (Date.now() - createdAt.getTime()) / 86400000 : 0;
          return s + ageDays;
        }, 0) / total) : 0;
        const longest = total > 0 ? Math.round(Math.max(...rows.map((r) => {
          const createdAt = readDate(asRow(r).created_at);
          return createdAt ? (Date.now() - createdAt.getTime()) / 86400000 : 0;
        }))) : 0;
        const byUrgency: Record<string, number> = {};
        rows.forEach((r) => {
          const urgency = readString(asRow(r).urgency, 'unknown');
          byUrgency[urgency] = (byUrgency[urgency] ?? 0) + 1;
        });
        const urgencyLines = Object.entries(byUrgency).map(([k, v]) => `  ${k}: ${v}`).join('\n');
        return text(`## Waitlist Metrics\n• Total Waiting: ${total}\n• Avg Wait Time: ${avgWait} days\n• Longest Waiting: ${longest} days\n\nBy Urgency:\n${urgencyLines || '  No data'}`);
      }

      case 'medication_metrics': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const q = db('patient_medications')
          .where({ clinic_id: auth.clinicId, status: 'active' })
          .whereNull('deleted_at');
        if (teamScope) {
          q.whereIn(
            'patient_id',
            db('episodes')
              .where({ clinic_id: auth.clinicId, status: 'open' })
              .whereIn('team_id', teamScope.ids)
              .whereNull('deleted_at')
              .select('patient_id'),
          );
        }
        const [total] = await q.clone().count('* as cnt');
        // PR-R1-13 DRAIN (2026-05-01): is_clozapine + is_s8 columns don't exist
        // on patient_medications. Canonical pattern per medicationService.ts:74
        // is `r.category === 'clozapine'` for clozapine detection. For S8,
        // join drug_products on schedule = '8' (the canonical Schedule-8
        // controlled-substance flag per drug_products.schedule column).
        // is_lai DOES exist on patient_medications and is correctly filtered.
        const [cloz] = await q.clone().where('category', 'clozapine').count('* as cnt');
        const [lai] = await q.clone().where('is_lai', true).count('* as cnt');
        const [s8] = await q.clone()
          .leftJoin('drug_products as dp', 'dp.id', 'patient_medications.drug_product_id')
          .where('dp.schedule', '8')
          .count('* as cnt');
        // Polypharmacy: patients with 5+ active meds
        const poly = await q.clone().groupBy('patient_id').havingRaw('COUNT(*) >= 5').select('patient_id');
        return text(`## Medication Metrics${teamScope ? ` — ${teamScope.label}` : ''}\n• Total Active Medications: ${asCount(total)}\n• Clozapine Patients: ${asCount(cloz)}\n• LAI Patients: ${asCount(lai)}\n• Schedule 8 Prescriptions: ${asCount(s8)}\n• Polypharmacy (5+ meds): ${poly.length} patients`);
      }

      case 'risk_overview': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const q = db('risk_assessments').where({ clinic_id: auth.clinicId }).whereNull('deleted_at');
        if (teamScope) {
          q.whereIn(
            'patient_id',
            db('episodes')
              .where({ clinic_id: auth.clinicId, status: 'open' })
              .whereIn('team_id', teamScope.ids)
              .whereNull('deleted_at')
              .select('patient_id'),
          );
        }
        const highRiskRows = await q.clone().whereIn('overall_risk_level', ['high', 'very_high'])
          .select('patient_id', 'overall_risk_level', 'created_at').orderBy('created_at', 'desc').limit(20);
        const [recentAssessments] = await q.clone().whereRaw(`created_at >= NOW() - INTERVAL '30 days'`).count('* as cnt');
        // Patients with open episodes but no risk assessment
        const openPatients = await db('episodes')
          .where({ clinic_id: auth.clinicId, status: 'open' })
          .whereNull('deleted_at')
          .select('patient_id')
          .then((r) => r.map((x) => readString(asRow(x).patient_id)).filter(Boolean));
        const assessedPatients = await db('risk_assessments')
          .where({ clinic_id: auth.clinicId })
          .whereNull('deleted_at')
          .whereIn('patient_id', openPatients)
          .distinct('patient_id')
          .then((r) => r.map((x) => readString(asRow(x).patient_id)).filter(Boolean));
        const unassessedIds = [...new Set(openPatients.filter((id: string) => !assessedPatients.includes(id)))];
        // Resolve names
        const highRiskLines = await mapSequential(highRiskRows, async (r) => {
          const row = asRow(r);
          const name = await resolvePatientName(readString(row.patient_id), auth.clinicId);
          const assessedAt = readDate(row.created_at);
          return `  - ${name} — Risk: ${readString(row.overall_risk_level)} (assessed ${assessedAt ? assessedAt.toLocaleDateString('en-AU') : 'unknown'})`;
        });
        const unassessedLines = await mapSequential(unassessedIds.slice(0, 10), async (id: string) => {
          const name = await resolvePatientName(id, auth.clinicId);
          return `  - ${name}`;
        });
        return text(`## Risk Overview${teamScope ? ` — ${teamScope.label}` : ''}\n• Patients at High/Very High Risk: ${highRiskRows.length}\n• Risk Assessments (last 30 days): ${asCount(recentAssessments)}\n• Open Patients Without Risk Assessment: ${unassessedIds.length}\n\nHigh Risk Patients:\n${highRiskLines.join('\n') || '  None'}\n\nUnassessed Patients:\n${unassessedLines.join('\n') || '  None'}`);
      }

      case 'task_metrics': {
        const teamScope = await resolveTeamScope(a.team, auth.clinicId);
        if (teamScope && teamScope.ids.length === 0) {
          return error(`Team not found: ${teamScope.requested}. Please use a valid team or unit name.`);
        }
        const { from, to } = periodRange(a.period);
        const base = db('tasks').where({ clinic_id: auth.clinicId });
        if (teamScope) {
          base.whereIn(
            'patient_id',
            db('episodes')
              .where({ clinic_id: auth.clinicId, status: 'open' })
              .whereIn('team_id', teamScope.ids)
              .whereNull('deleted_at')
              .select('patient_id'),
          );
        }
        const [open] = await base.clone().whereIn('status', OPEN_TASK_STATUSES).count('* as cnt');
        const [overdue] = await base.clone().whereIn('status', OPEN_TASK_STATUSES).where('due_date', '<', new Date()).count('* as cnt');
        const [completed] = await base.clone().where('status', 'completed').whereBetween('completed_at', [from, to]).count('* as cnt');
        // Top assignees with overdue
        const byAssignee = await base.clone().whereIn('status', OPEN_TASK_STATUSES).where('due_date', '<', new Date())
          .join('staff', 'tasks.assigned_to_id', 'staff.id')
          .groupBy('staff.id', 'staff.given_name', 'staff.family_name')
          .select('staff.given_name', 'staff.family_name', db.raw('COUNT(*) as cnt'))
          .orderBy('cnt', 'desc').limit(10);
        const assigneeLines = byAssignee.map((r) => {
          const row = asRow(r);
          return `  ${readString(row.given_name)} ${readString(row.family_name)}: ${readString(row.cnt)} overdue`;
        }).join('\n');
        return text(`## Task Metrics${teamScope ? ` — ${teamScope.label}` : ''} (${a.period ?? 'month'})\n• Open Tasks: ${asCount(open)}\n• Overdue Tasks: ${asCount(overdue)}\n• Completed (this period): ${asCount(completed)}\n\nOverdue by Staff:\n${assigneeLines || '  None'}`);
      }

        default: return error(`Unknown tool: ${call.name}`);
      }
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[MCP] Tool execution failed',
    );
    return error('Tool error: Unable to complete this request right now. Please retry.');
  }
}

function text(t: string): McpToolResult { return { content: [{ type: 'text', text: t }] }; }
function error(msg: string): McpToolResult { return { content: [{ type: 'text', text: msg }], isError: true }; }

// ============ MCP JSON-RPC Handler ============

/**
 * BUG-281 — AuthContext-required entry point. Callers MUST pass the
 * AuthContext of the originating request so tool handlers that touch
 * patient data can enforce requirePatientRelationship. Previously the
 * dispatcher ran without any auth propagation — non-HTTP invocations
 * (future BullMQ / WebSocket) would have bypassed all gating.
 */
type McpJsonRpcBody = {
  id?: unknown;
  method?: string;
  params?: { name?: string; arguments?: Record<string, string | undefined> };
};

export async function handleMcpRequest(body: unknown, auth: AuthContext): Promise<unknown> {
  const payload = (body ?? {}) as McpJsonRpcBody;
  const { id, method, params } = payload;
  switch (method) {
    case 'initialize': return { id, result: { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'signacare-emr-mcp', version: '1.0.0' } } };
    case 'tools/list': return { id, result: { tools: MCP_TOOLS } };
    case 'tools/call':
      return {
        id,
        result: await handleToolCall(
          { name: params?.name ?? '', arguments: params?.arguments ?? {} },
          auth,
        ),
      };
    case 'ping': return { id, result: {} };
    default: return { id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}
