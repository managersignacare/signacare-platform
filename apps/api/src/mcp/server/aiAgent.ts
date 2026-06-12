/**
 * Signacare EMR — AI Clinical Agent
 *
 * Autonomous agent with MCP tools + local LLMs.
 * Has a direct-tool fallback when LLM is unavailable.
 *
 * Hallucination guards:
 *   1. Direct pattern matching bypasses LLM entirely for known queries
 *   2. System prompt explicitly forbids fabrication
 *   3. First-response number check forces tool use
 *   4. Confidence phrases detected and rejected
 *   5. Max tool-less iterations capped at 1
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { MCP_TOOLS } from './mcpToolCatalog';
import { handleToolCall } from './mcpServer';
import { logger } from '../../utils/logger';
import type { AiStructuredScope, AuthContext, RoutedModelExecution } from '@signacare/shared';
import { requirePatientRelationship } from '../../shared/authGuards';
import {
  resolveLockedRuntimeSelection,
  routeTextGeneration,
  type LockedAiRuntimeSelection,
} from '../../features/llm/modelRouter/modelRouter';

/**
 * BUG-281 — AuthContext propagation for the aiAgent call chain.
 * Using AsyncLocalStorage avoids cascading `auth` parameter threading
 * through every DIRECT_QUERIES handler + runLlmAgentLoop + callAndFormat.
 * Inner helpers pick up the current auth via `agentAuthStore.getStore()`;
 * a missing store means the call bypassed `runAgent` which is a bug —
 * throw hard so tests catch the misuse.
 */
const agentAuthStore = new AsyncLocalStorage<AuthContext>();

function currentAuth(): AuthContext {
  const auth = agentAuthStore.getStore();
  if (!auth) {
    throw new Error('BUG-281: aiAgent helper called outside runAgent — AuthContext missing');
  }
  return auth;
}

const MAX_ITERATIONS = 6;

type ToolArguments = Record<string, string | undefined>;

interface AgentToolCall {
  tool: string;
  args: ToolArguments;
  result: string;
}

function normaliseToolArgs(raw: unknown): ToolArguments {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries: Array<[string, string | undefined]> = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null) {
      entries.push([key, undefined]);
    } else if (typeof value === 'string') {
      entries.push([key, value]);
    } else {
      entries.push([key, String(value)]);
    }
  }
  return Object.fromEntries(entries);
}

interface ParsedToolCall {
  name: string;
  arguments: ToolArguments;
}

function parseToolCallFromResponse(responseText: string): ParsedToolCall | null {
  const fencedMatch = responseText.match(/```(?:tool|json)?\s*\n?([\s\S]*?)\n?```/);
  const rawJsonMatch = responseText.match(/\{[\s\S]*"name"[\s\S]*\}/);
  const explicitToolMatch = responseText.match(
    /^\s*tool\s+([a-zA-Z0-9_:-]+)\s*(\{[\s\S]*\})?\s*$/i,
  );

  try {
    if (fencedMatch?.[1]) {
      const parsed = JSON.parse(fencedMatch[1].trim()) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name === 'string') {
        return { name: parsed.name, arguments: normaliseToolArgs(parsed.arguments) };
      }
    }
    if (rawJsonMatch?.[0]) {
      const parsed = JSON.parse(rawJsonMatch[0].trim()) as { name?: unknown; arguments?: unknown };
      if (typeof parsed.name === 'string') {
        return { name: parsed.name, arguments: normaliseToolArgs(parsed.arguments) };
      }
    }
    if (explicitToolMatch?.[1]) {
      const name = explicitToolMatch[1].trim();
      const argJson = explicitToolMatch[2]?.trim();
      if (!argJson) {
        return { name, arguments: {} };
      }
      const parsedArgs = JSON.parse(argJson) as unknown;
      return { name, arguments: normaliseToolArgs(parsedArgs) };
    }
  } catch (_parseErr) {
    return null;
  }
  return null;
}

// ── Hallucination Detection ─────────────────────────────────────────────────

const HALLUCINATION_PHRASES = [
  /\b(?:approximately|roughly|around|about|estimated|typically|usually|generally)\s+\d/i,
  /\bI (?:believe|think|assume|estimate|would say)\b/i,
  /\b(?:as of my|based on my|from my)\s+(?:knowledge|training|data)/i,
  /\b(?:hypothetical|for (?:demonstration|example) purposes)\b/i,
  /\b(?:the data (?:suggests|indicates|shows))\b.*\b\d{3,}\b/i,
];

function detectHallucination(text: string, toolCallsMade: number): string | null {
  // Guard 1: Numbers without tool calls
  if (toolCallsMade === 0 && /\b\d{2,}\b/.test(text)) {
    return 'Response contains specific numbers but no tool was called to retrieve real data.';
  }
  // Guard 2: Hedging language with numbers
  for (const pattern of HALLUCINATION_PHRASES) {
    if (pattern.test(text)) {
      return `Response contains hedging language suggesting fabricated data: "${text.match(pattern)?.[0]}"`;
    }
  }
  // Guard 3: UUID-like strings that look fabricated
  if (toolCallsMade === 0 && /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
    return 'Response contains UUID-like identifiers without having queried the database.';
  }
  return null;
}

// ── Tool Result Formatter ───────────────────────────────────────────────────

function formatToolResult(toolName: string, rawText: string): string {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  switch (toolName) {
    case 'list_staff': {
      const header = '## Staff Directory\n\n| Name | Role | Discipline |\n|------|------|------------|\n';
      const rows = lines.map(l => {
        const match = l.match(/^(.+?)\s*—\s*(.+?)(?:\s*\((.+?)\))?$/);
        if (match) return `| ${match[1].trim()} | ${match[2].trim()} | ${match[3]?.trim() ?? '—'} |`;
        return `| ${l} | — | — |`;
      }).join('\n');
      return header + rows;
    }
    case 'org_statistics': {
      return '## Organisation Overview\n\n' + rawText
        .replace(/Organisation Statistics:\n?/i, '')
        .replace(/•\s*/g, '')
        .split('\n').map(l => {
          const kv = l.match(/^(.+?):\s*(.+)$/);
          if (kv) return `**${kv[1].trim()}:** ${kv[2].trim()}`;
          if (l.trim().startsWith('Team Breakdown')) return '\n### Team Breakdown\n';
          const team = l.match(/^\s*(.+?):\s*(\d+)\s*patients?/i);
          if (team) return `- **${team[1].trim()}**: ${team[2]} patients`;
          return l;
        }).filter(Boolean).join('\n');
    }
    case 'team_caseload': {
      const teamMatch = rawText.match(/Team\s+(.+?)\s+Caseload/i);
      const countMatch = rawText.match(/Patients:\s*(\d+)/i);
      const title = `## ${teamMatch?.[1] ?? 'Team'} Caseload${countMatch ? ` (${countMatch[1]} patients)` : ''}\n\n`;
      const patients = lines.filter(l => l.startsWith('•')).map(l => {
        const m = l.replace(/^•\s*/, '').match(/^(.+?)\s*—\s*(.+?)(?:\s*\((.+?)\))?$/);
        if (m) return `| ${m[1].trim()} | ${m[2].trim()} | ${m[3]?.trim() ?? '—'} |`;
        return `| ${l.replace(/^•\s*/, '')} | — | — |`;
      });
      if (patients.length) return title + '| Patient | Diagnosis | Details |\n|---------|-----------|----------|\n' + patients.join('\n');
      return title + rawText;
    }
    case 'staff_workload': {
      const nameMatch = rawText.match(/Staff:\s*(.+?)(?:\s*\((.+?)\))/);
      const title = nameMatch ? `## ${nameMatch[1].trim()}\n**Role:** ${nameMatch[2].trim()}\n\n` : '## Staff Workload\n\n';
      const metrics = lines.filter(l => l.startsWith('•')).map(l => {
        const kv = l.replace(/^•\s*/, '').match(/^(.+?):\s*(.+)$/);
        if (kv) return `| ${kv[1].trim()} | **${kv[2].trim()}** |`;
        return null;
      }).filter(Boolean);
      if (metrics.length) return title + '| Metric | Value |\n|--------|-------|\n' + metrics.join('\n');
      return title + rawText;
    }
    case 'overdue_reviews': {
      const title = '## Overdue Reviews\n\n';
      if (rawText.includes('No overdue') || rawText.includes('0 overdue') || lines.length === 0) return title + 'No overdue reviews found.';
      return title + lines.filter(l => l.startsWith('•') || l.startsWith('-')).map(l => `- ${l.replace(/^[•-]\s*/, '')}`).join('\n');
    }
    case 'list_legal_orders': {
      const title = '## Legal / MHA Orders\n\n';
      if (rawText.includes('No active') || rawText.includes('No legal') || lines.length <= 1) return title + 'No active legal orders found.';
      return title + lines.filter(l => l.startsWith('•') || l.startsWith('-')).map(l => `- ${l.replace(/^[•-]\s*/, '')}`).join('\n');
    }
    case 'list_medications': {
      const title = '## Medications\n\n';
      const rows = lines.filter(l => l.startsWith('•') || l.startsWith('-')).map(l => {
        const text = l.replace(/^[•-]\s*/, '');
        return `- ${text}`;
      });
      return rows.length ? title + rows.join('\n') : title + (rawText || 'No medications recorded.');
    }
    case 'search_drug_interactions':
      return '## Drug Interaction Check\n\n' + rawText;
    default:
      return rawText;
  }
}

// ── Helper: call tool and format ────────────────────────────────────────────

async function callAndFormat(toolName: string, args: ToolArguments): Promise<{ answer: string; toolCalls: AgentToolCall[] }> {
  const r = await handleToolCall({ name: toolName, arguments: args }, currentAuth());
  const raw = r.content[0].text;
  return { answer: formatToolResult(toolName, raw), toolCalls: [{ tool: toolName, args, result: raw }] };
}

const TEAM_TOKEN_STOP_WORDS = new Set([
  'all',
  'team',
  'unit',
  'service',
  'team name',
  'unit name',
  'team a',
  'team b',
  'name',
  'this',
  'that',
  'these',
  'those',
]);

function normaliseTeamToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/\[[^\]]+\]/g, '');
  cleaned = cleaned.replace(/^[\s"'([{]+/, '');
  cleaned = cleaned.replace(/[\s"')\].,;:!?]+$/g, '');
  cleaned = cleaned.replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/\b(?:caseload|case\s*load|patient(?:\s*list)?|patients|reviews?|metrics?|activity|overview|summary)\b.*$/i, '').trim();
  if (!cleaned) return undefined;
  if (TEAM_TOKEN_STOP_WORDS.has(cleaned.toLowerCase())) return undefined;
  return cleaned;
}

// Helper to extract a team/unit name from natural-language query text.
function extractTeam(input: string, scopedTeamLabels?: string[]): string | undefined {
  const punctuationSafe = input.trim().replace(/[?!]+$/g, '');
  const contextLabel = input.match(/\(\s*team\s*:\s*([^)]+)\)/i);
  if (contextLabel) {
    return normaliseTeamToken(contextLabel[1]);
  }
  const namedLabel = input.match(/\bteam\s*[:=-]\s*([^,.;)\n]+)/i);
  if (namedLabel) {
    return normaliseTeamToken(namedLabel[1]);
  }
  const quoted = input.match(/\b(?:team|unit)\s+(?:for|in|on|of)?\s*["“]([^"”]+)["”]/i);
  if (quoted) {
    return normaliseTeamToken(quoted[1]);
  }
  const afterFor = punctuationSafe.match(/\b(?:for|in|on)\s+([A-Za-z][A-Za-z0-9/&\- ]{1,80})$/i);
  if (afterFor) {
    return normaliseTeamToken(afterFor[1]);
  }
  const afterHowMany = punctuationSafe.match(/\bhow\s+many\s+patients\s+in\s+([A-Za-z][A-Za-z0-9/&\- ]{1,80})$/i);
  if (afterHowMany) {
    return normaliseTeamToken(afterHowMany[1]);
  }
  const afterWhoIsOn = punctuationSafe.match(/\bwho\s+is\s+on\s+([A-Za-z][A-Za-z0-9/&\- ]{1,80})$/i);
  if (afterWhoIsOn) {
    return normaliseTeamToken(afterWhoIsOn[1]);
  }
  const afterTeam = punctuationSafe.match(/\b(?:team|unit)\s+(?:for|in|on|of)?\s+([A-Za-z][A-Za-z0-9/&\- ]{1,80})/i);
  if (afterTeam) {
    return normaliseTeamToken(afterTeam[1]);
  }
  if (scopedTeamLabels?.length === 1) {
    return normaliseTeamToken(scopedTeamLabels[0]);
  }
  return undefined;
}

// ── System Prompt ───────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are the Signacare EMR Clinical AI Agent for Australian public mental health services.

CRITICAL RULES — FOLLOW THESE EXACTLY:
1. NEVER invent, estimate, or fabricate ANY numbers, patient counts, names, or clinical data.
2. You MUST call a tool BEFORE answering any question about patients, counts, statistics, caseloads, reviews, medications, or clinical activity.
3. If you don't have tool results yet, your ENTIRE response must be a tool call. Do NOT write any other text.
4. After receiving tool results, summarise ONLY what the tool returned. Add NOTHING that wasn't in the tool response.
5. If a tool returns no data or an error, say "No data found" — do NOT guess or estimate.
6. NEVER use phrases like "approximately", "around", "estimated", "typically", "I believe", or "based on my knowledge".

Available tools:
${MCP_TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Which tool to use:
- Patient counts, caseload, team activity, ABF contacts → team_caseload {"team": "team name"}
- Organisation-wide stats → org_statistics {}
- Staff workload, appointments, pending notes → staff_workload {"staffId": "name"}
- Overdue 91-day reviews, MHA reviews → overdue_reviews {"team": "optional"}
- Legal/MHA orders → list_legal_orders {"patientId": "optional"}
- Patient medications → list_medications {"patientId": "id", "status": "all"}
- Patient clinical data → get_patient_context {"patientId": "id", "clinicId": "id"}
- All staff → list_staff {}
- Drug interactions → search_drug_interactions {"drugs": "drug1, drug2"}

To call a tool, respond with ONLY:
\`\`\`tool
{"name": "tool_name", "arguments": {"key": "value"}}
\`\`\`

After tool results, write a clear summary using markdown tables and headings.`;

// ── Direct Query Patterns (bypass LLM entirely) ────────────────────────────

type DirectHandler = (
  match: RegExpMatchArray,
  ctx: {
    clinicId: string;
    patientId?: string;
    scopeTeamLabels?: string[];
  },
) => Promise<{ answer: string; toolCalls: AgentToolCall[] }>;

const DIRECT_QUERIES: { pattern: RegExp; handler: DirectHandler }[] = [
  // ── Organisation ──
  { pattern: /org(?:anisation|anization)?\s*stat/i, handler: async () => callAndFormat('org_statistics', {}) },
  { pattern: /(?:service|org)\s*(?:overview|dashboard|summary)/i, handler: async () => callAndFormat('org_statistics', {}) },

  // ── Team caseload (with team name extraction) ──
  { pattern: /team\s+caseload|caseload\s+for|case\s*load\s+for|patient\s*list\s+for|who\s+is\s+on|how\s+many\s+patients\s+in/i, handler: async (m) => {
    const auth = currentAuth();
    const extracted = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    if (!extracted) {
      return {
        answer: 'Please include a team or unit name, e.g. "Team caseload for North Community Team".',
        toolCalls: [],
      };
    }
    return callAndFormat('team_caseload', { team: extracted });
  }},

  // ── Staff workload ──
  { pattern: /(?:staff\s+)?workload\s+(?:for\s+)?(.+)/i, handler: async (m) => {
    const name = m[1].trim().replace(/^(the|dr|dr\.|doctor|nurse|of)\s+/i, '');
    return callAndFormat('staff_workload', { staffId: name });
  }},
  { pattern: /(?:how busy|how much work|caseload|case\s*load)\s+(?:is|does|for)\s+(.+)/i, handler: async (m) => {
    const name = m[1].trim().replace(/^(the|dr|dr\.|doctor|nurse|of)\s+/i, '').replace(/\?$/, '');
    return callAndFormat('staff_workload', { staffId: name });
  }},

  // ── Overdue reviews / upcoming ──
  { pattern: /overdue\s*(?:review|91|assessment|task)/i, handler: async (m) => {
    const auth = currentAuth();
    const team = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    return callAndFormat('overdue_reviews', team ? { team } : {});
  }},
  { pattern: /upcoming\s*(?:review|91|hearing|tribunal|assessment)/i, handler: async (m) => {
    const auth = currentAuth();
    const team = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    return callAndFormat('overdue_reviews', team ? { team } : {});
  }},
  { pattern: /(?:due|pending)\s*(?:review|assessment|91|task)/i, handler: async (m) => {
    const auth = currentAuth();
    const team = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    return callAndFormat('overdue_reviews', team ? { team } : {});
  }},

  // ── Legal / MHA orders ──
  { pattern: /legal\s*order|mha\s*order|treatment\s*order|community\s*treatment|CTO|involuntary/i, handler: async (_m, ctx) =>
    callAndFormat('list_legal_orders', ctx.patientId ? { patientId: ctx.patientId } : {})
  },

  // ── Staff directory ──
  { pattern: /list\s*(?:all\s*)?staff|who\s*(?:is|are)\s*(?:the\s*)?staff|staff\s*(?:list|directory|roster)/i, handler: async () =>
    callAndFormat('list_staff', {})
  },

  // ── Medications ──
  { pattern: /medication|meds?\s+(?:for|of)|what\s*(?:meds|medication)/i, handler: async (_m, ctx) => {
    if (!ctx.patientId) return { answer: 'Please select a patient to view medications.', toolCalls: [] };
    return callAndFormat('list_medications', { patientId: ctx.patientId, status: 'all' });
  }},

  // ── Alerts / flags ──
  { pattern: /list\s*alerts?|alert\s*list|patient\s*alerts?|flags?/i, handler: async (_m, ctx) => {
    if (!ctx.patientId) return { answer: 'Please select a patient to view active alerts.', toolCalls: [] };
    return callAndFormat('list_alerts', { patientId: ctx.patientId });
  }},

  // ── Drug interactions ──
  { pattern: /interaction|drug.interact/i, handler: async (m) => {
    const drugs = m.input?.replace(/.*(?:between|for|check)\s*/i, '').trim() ?? '';
    if (!drugs) return { answer: 'Please specify drugs to check, e.g. "Check interactions between lithium and olanzapine"', toolCalls: [] };
    return callAndFormat('search_drug_interactions', { drugs });
  }},

  // ── ABF / clinical activity / contacts ──
  { pattern: /abf|contact.*activit|clinical.*activit|reportable|service\s*contact/i, handler: async (m) => {
    const team = extractTeam(m.input ?? '');
    if (team) {
      const result = await callAndFormat('team_caseload', { team });
      result.answer = `## ABF / Clinical Activity — ${team}\n\n${result.answer}`;
      return result;
    }
    const result = await callAndFormat('org_statistics', {});
    result.answer = `## ABF / Clinical Activity\n\n${result.answer}`;
    return result;
  }},

  // ── Patient counts ──
  { pattern: /how many patient|patient count|total patient|number of patient/i, handler: async (m) => {
    const team = extractTeam(m.input ?? '');
    if (team) return callAndFormat('team_caseload', { team });
    return callAndFormat('org_statistics', {});
  }},

  // ── Patient summary ──
  { pattern: /patient.*summary|summarise.*patient|patient.*context|clinical.*summary|tell me about/i, handler: async (_m, ctx) => {
    if (!ctx.patientId) return { answer: 'Please select a patient first to view their clinical summary.', toolCalls: [] };
    return callAndFormat('get_patient_context', { patientId: ctx.patientId, clinicId: ctx.clinicId });
  }},

  // ── Appointments ──
  { pattern: /appointment|appt|schedule|diary|today.*clinic/i, handler: async (_m, ctx) => {
    if (ctx.patientId) return callAndFormat('get_patient_context', { patientId: ctx.patientId, clinicId: ctx.clinicId });
    return callAndFormat('org_statistics', {});
  }},

  // ── Combination: team + staff ──
  { pattern: /(?:who|which\s+staff).*(?:in|on)\s+(.+)/i, handler: async (m) => {
    const extracted = extractTeam(m.input ?? '') ?? normaliseTeamToken(m[1]);
    if (!extracted) {
      return {
        answer: 'Please include a team or unit name when asking for staff allocation.',
        toolCalls: [],
      };
    }
    return callAndFormat('team_caseload', { team: extracted });
  }},

  // ── Compare teams ──
  { pattern: /compare\s+(.+?)\s+(?:and|vs|with|to)\s+(.+)/i, handler: async (m) => {
    const left = normaliseTeamToken(m[1]);
    const right = normaliseTeamToken(m[2]);
    if (!left || !right) {
      return {
        answer: 'Please provide two team or unit names to compare, e.g. "Compare North Team and South Team".',
        toolCalls: [],
      };
    }
    const r1 = await handleToolCall(
      { name: 'team_caseload', arguments: { team: left } },
      currentAuth(),
    );
    const r2 = await handleToolCall(
      { name: 'team_caseload', arguments: { team: right } },
      currentAuth(),
    );
    const raw1 = r1.content[0].text, raw2 = r2.content[0].text;
    return {
      answer: `${formatToolResult('team_caseload', raw1)}\n\n---\n\n${formatToolResult('team_caseload', raw2)}`,
      toolCalls: [
        { tool: 'team_caseload', args: { team: left }, result: raw1 },
        { tool: 'team_caseload', args: { team: right }, result: raw2 },
      ],
    };
  }},

  // ── Manager Metrics ──
  { pattern: /referral\s*(?:metric|stat|rate|intake|sla|compliance)/i, handler: async (m) => {
    const team = extractTeam(m.input ?? '');
    return callAndFormat('referral_metrics', { period: 'month', ...(team ? { team } : {}) });
  }},
  { pattern: /(?:dna|no.?show|did not attend|missed.*appt|cancellation.*rate|appointment.*metric|appointment.*stat)/i, handler: async (m) => {
    const team = extractTeam(m.input ?? '');
    return callAndFormat('appointment_metrics', { period: 'month', ...(team ? { team } : {}) });
  }},
  { pattern: /(?:notes?\s*(?:written|signed|unsigned|draft|per\s*clinician)|clinical\s*(?:contact|activity)|abf\s*(?:contact|report|metric))/i, handler: async (m) => {
    const team = extractTeam(m.input ?? '');
    return callAndFormat('clinical_activity', { period: 'month', ...(team ? { team } : {}) });
  }},
  { pattern: /bed\s*(?:occupancy|status|available|board)|inpatient\s*(?:bed|occupancy|capacity)/i, handler: async () =>
    callAndFormat('bed_occupancy', {})
  },
  { pattern: /discharge\s*(?:metric|stat|rate|reason)|episode.*close|closed\s*episode/i, handler: async (m) => {
    const team = extractTeam(m.input ?? '');
    return callAndFormat('discharge_metrics', { period: 'month', ...(team ? { team } : {}) });
  }},
  { pattern: /wait\s*list|waiting\s*list|wait\s*time|queue/i, handler: async () =>
    callAndFormat('waitlist_metrics', {})
  },
  { pattern: /medication\s*(?:metric|stat|overview)|clozapine\s*(?:count|patient|number)|lai\s*(?:count|patient)|polypharmacy|s8\s*(?:count|prescription)/i, handler: async (m) => {
    const auth = currentAuth();
    const team = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    return callAndFormat('medication_metrics', team ? { team } : {});
  }},
  { pattern: /risk\s*(?:overview|summary|metric|dashboard)|high\s*risk\s*patient|unassessed\s*patient/i, handler: async (m) => {
    const auth = currentAuth();
    const team = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    return callAndFormat('risk_overview', team ? { team } : {});
  }},
  { pattern: /task\s*(?:metric|stat|overdue|overview)|overdue\s*task|pending\s*task/i, handler: async (m) => {
    const auth = currentAuth();
    const team = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    return callAndFormat('task_metrics', { period: 'month', ...(team ? { team } : {}) });
  }},

  // ── Catch-all: explicit "team/unit" mention without a specific metric keyword ──
  { pattern: /\b(?:team|unit)\b/i, handler: async (m) => {
    const auth = currentAuth();
    const extracted = extractTeam(m.input ?? '', auth.aiScope?.teamLabels);
    if (!extracted) return { answer: 'Please specify what you need for this team (e.g. caseload, overdue reviews, activity).', toolCalls: [] };
    return callAndFormat('team_caseload', { team: extracted });
  }},
];

// ── Agent Entry Point ───────────────────────────────────────────────────────

interface AgentResult {
  answer: string;
  toolCalls: AgentToolCall[];
  iterations: number;
  model: string;
  /** BUG-037 — immutable model version (digest-preferred; tag-fallback). */
  modelVersion?: string;
  /** BUG-037 — requested temperature passed into the LLM (not echoed by Ollama). */
  requestedTemperature?: number;
  /** Runtime-aware execution details for provider-neutral audit paths. */
  execution?: RoutedModelExecution;
  /** Local fallback trace when a requested local model degraded to default. */
  fallbackFromModelName?: string | null;
}

function buildRequestedLocalModel(
  runtimeSelection: LockedAiRuntimeSelection,
  explicitModel?: string,
): string | undefined {
  if (runtimeSelection.backend !== 'local_ollama') return undefined;
  return explicitModel?.trim() || undefined;
}

export async function runAgent(
  query: string,
  auth: AuthContext,
  model?: string,
  scope?: AiStructuredScope,
): Promise<AgentResult> {
  // BUG-281 — AuthContext-first per CLAUDE.md §13. `agentAuthStore.run`
  // sets the AsyncLocalStorage so every downstream DIRECT_QUERIES
  // handler + runLlmAgentLoop + handleToolCall invocation reaches the
  // SAME caller-supplied auth via `currentAuth()`. No cascading
  // parameter threading through each handler; no magic global.
  return agentAuthStore.run(auth, async () => {
    return runAgentInner(query, { ...auth, aiScope: scope ?? auth.aiScope }, model);
  });
}

async function runAgentInner(
  query: string,
  auth: AuthContext,
  model?: string,
): Promise<AgentResult> {
  if (/\[(?:team\s*name|team|staff\s*name|staff|patient\s*name|patient)\]/i.test(query)) {
    return {
      answer: 'Please remove placeholder tags and ask directly, or use the context selector before sending the prompt.',
      toolCalls: [],
      iterations: 1,
      model: 'direct-tool',
    };
  }

  const runtimeSelection = await resolveLockedRuntimeSelection(auth.clinicId);
  const requestedLocalModel = buildRequestedLocalModel(runtimeSelection, model);

  // Gate on requirePatientRelationship BEFORE any tool dispatch so
  // every downstream handler operates under a verified relationship.
  // Previously this function inlined an incorrect AuthContext with
  // `role: 'clinician', permissions: []` — the caller's actual
  // identity is now passed through so requirePatientRelationship
  // sees the real role (including admin/superadmin bypass via
  // nominated-admin).
  if (auth.patientId) {
    await requirePatientRelationship(auth, auth.patientId);
  }

  // Internal helpers (DIRECT_QUERIES handlers, runLlmAgentLoop)
  // still expect the legacy shape — build it locally without
  // changing those signatures this commit.
  const context: { clinicId: string; patientId?: string; staffId?: string } = {
    clinicId: auth.clinicId,
    patientId: auth.patientId,
    staffId: auth.staffId,
  };



  // Step 1: Direct pattern matching (no LLM, no hallucination possible)
  for (const dq of DIRECT_QUERIES) {
    const match = query.match(dq.pattern);
    if (match) {
      try {
        const result = await dq.handler(match, context);
        return { ...result, iterations: 1, model: 'direct-tool' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, '[Agent] Direct query handler failed');
        return {
          answer: 'I could not complete that request right now. Please try again.',
          toolCalls: [],
          iterations: 1,
          model: 'direct-tool',
        };
      }
    }
  }

  // Step 2: LLM agent loop
  try {
    return await runLlmAgentLoop(
      query,
      context,
      runtimeSelection,
      requestedLocalModel,
      auth.aiScope,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[Agent] LLM agent loop failed');
    try {
      return await fallbackToolAnswer(query, context);
    } catch {
      return {
        answer: `I couldn't process your request right now. Please try again.\n\nTry one of these:\n- "Organisation statistics"\n- "Team caseload for North Community Team"\n- "Overdue 91-day reviews"\n- "List all staff"\n- "Staff workload for Jane Smith"`,
        toolCalls: [], iterations: 0, model: 'error',
      };
    }
  }
}

// ── LLM Agent Loop ──────────────────────────────────────────────────────────

async function runLlmAgentLoop(
  query: string,
  context: { clinicId: string; patientId?: string },
  runtimeSelection: LockedAiRuntimeSelection,
  requestedLocalModel: string | undefined,
  scope?: AiStructuredScope,
): Promise<AgentResult> {
  const messages: { role: string; content: string }[] = [];
  const toolCalls: AgentResult['toolCalls'] = [];

  let userPrompt = query;
  if (context.patientId) userPrompt += `\n\n[Patient ID: ${context.patientId}, Clinic: ${context.clinicId}]`;
  else userPrompt += `\n\n[Clinic: ${context.clinicId}]`;
  if (scope) {
    userPrompt += `\n[Structured Scope: ${JSON.stringify(scope)}]`;
  }
  messages.push({ role: 'user', content: userPrompt });

  let hallucinationRetries = 0;
  // BUG-037 — capture the last LLM response's audit fields so the /agent
  // handler can record the final-iteration model_version and requested
  // temperature in llm_interactions. Agent loops may span multiple calls;
  // we audit the terminal call that produced the returned answer.
  let lastExecution: RoutedModelExecution | undefined;
  let lastModelVersion: string | undefined;
  let lastRequestedTemperature: number | undefined;
  let lastFallbackFromModelName: string | null = null;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const conversationText = messages.map(m =>
      m.role === 'user' ? `User: ${m.content}` : m.role === 'tool' ? `Tool Result:\n${m.content}` : `Assistant: ${m.content}`
    ).join('\n\n');

    const llmResp = await routeTextGeneration({
      clinicId: context.clinicId,
      runtimeSelection,
      alias: 'fast_clinical',
      allowLocalStyleAdapter: false,
      system: AGENT_SYSTEM_PROMPT,
      prompt: conversationText,
      requestedModel: requestedLocalModel,
      temperature: 0.1, // Lower temp = less creative = fewer hallucinations
      maxTokens: 3000,
      action: 'agent',
    });

    const responseText = llmResp.text;
    lastExecution = llmResp.execution;
    lastModelVersion = llmResp.execution.modelVersion ?? undefined;
    lastRequestedTemperature = 0.1;
    lastFallbackFromModelName = llmResp.fallbackFromModelName ?? null;
    if (!responseText || responseText.includes('[AI unavailable')) throw new Error('LLM not available');

    messages.push({ role: 'assistant', content: responseText });

    const parsedToolCall = parseToolCallFromResponse(responseText);
    if (parsedToolCall) {
      const result = await handleToolCall(
        { name: parsedToolCall.name, arguments: parsedToolCall.arguments },
        currentAuth(),
      );
      const resultText = result.content.map((c) => c.text).join('\n');
      toolCalls.push({
        tool: parsedToolCall.name,
        args: parsedToolCall.arguments,
        result: resultText,
      });
      messages.push({
        role: 'tool',
        content: `[${parsedToolCall.name}]\n${resultText.substring(0, 3000)}`,
      });
      continue;
    }

    // No tool call — check for hallucination
    const hallucinationReason = detectHallucination(responseText, toolCalls.length);
    if (hallucinationReason && hallucinationRetries < 2) {
      hallucinationRetries++;
      logger.warn({ iteration: i, reason: hallucinationReason, retries: hallucinationRetries }, '[Agent] Hallucination detected — forcing tool use');
      messages.push({
        role: 'user',
        content: `STOP. ${hallucinationReason} You MUST call a tool to get real data from the database. Do NOT write any text — respond ONLY with a tool call. Use org_statistics, team_caseload, staff_workload, or overdue_reviews.`,
      });
      continue;
    }

    // If we have tool results, format the answer
    if (toolCalls.length > 0) {
      return {
        answer: responseText,
        toolCalls,
        iterations: i + 1,
        model: lastExecution?.modelName ?? requestedLocalModel ?? 'unknown',
        modelVersion: lastModelVersion,
        requestedTemperature: lastRequestedTemperature,
        execution: lastExecution,
        fallbackFromModelName: lastFallbackFromModelName,
      };
    }

    // No tools called and no hallucination (probably a general knowledge question)
    return {
      answer: responseText,
      toolCalls,
      iterations: i + 1,
      model: lastExecution?.modelName ?? requestedLocalModel ?? 'unknown',
      modelVersion: lastModelVersion,
      requestedTemperature: lastRequestedTemperature,
      execution: lastExecution,
      fallbackFromModelName: lastFallbackFromModelName,
    };
  }

  return {
    answer: messages[messages.length - 1]?.content ?? 'Max iterations reached.',
    toolCalls,
    iterations: MAX_ITERATIONS,
    model: lastExecution?.modelName ?? requestedLocalModel ?? 'unknown',
    modelVersion: lastModelVersion,
    requestedTemperature: lastRequestedTemperature,
    execution: lastExecution,
    fallbackFromModelName: lastFallbackFromModelName,
  };
}

// ── Fallback ────────────────────────────────────────────────────────────────

async function fallbackToolAnswer(_query: string, context: { clinicId: string; patientId?: string }): Promise<AgentResult> {
  if (context.patientId) {
    const result = await callAndFormat('get_patient_context', { patientId: context.patientId, clinicId: context.clinicId });
    return { ...result, iterations: 1, model: 'fallback-tools' };
  }
  const result = await callAndFormat('org_statistics', {});
  return { answer: `Here's the current data:\n\n${result.answer}`, toolCalls: result.toolCalls, iterations: 1, model: 'fallback-tools' };
}
