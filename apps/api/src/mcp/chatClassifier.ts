// apps/api/src/mcp/chatClassifier.ts
//
// Audit Tier 5.3 — AI Chat classifier (dual-mode).
//
// User direction (2026-04-19): BOTH modes must be supported:
//
//   - regex_keyword  — fast, deterministic. Matches prescribing verbs,
//     dosage units, and controlled-drug names. No model call. Safe
//     fallback; 10-50ms budget.
//   - local_llm      — legacy mode name retained for compatibility.
//     Implementation now routes a structured binary BLOCK/ALLOW prompt
//     through the clinic's locked AI backend selection. More accurate
//     on natural-language prompts but slower than regex fallback.
//
// Per-clinic mode is stored on clinic_settings.ai_chat_classifier_mode.
// Callers use `classifyForClinic(clinicId, text)` which reads the
// clinic's configured mode, dispatches accordingly, and returns a
// normalised result. A classifier hit (`reason` ∈ PRESCRIBING_REASONS)
// MUST be rejected by the calling handler + audit-logged.

import logger from '../utils/logger';
import { db } from '../db/db';
import {
  resolveLockedRuntimeSelection,
  routeTextGeneration,
  type LockedAiRuntimeSelection,
} from '../features/llm/modelRouter/modelRouter';

export type ClassifierMode = 'regex_keyword' | 'local_llm';

export type PrescribingReason =
  | 'prescribing_verb'
  | 'dosage_instruction'
  | 'controlled_drug_mention'
  | 'model_flagged';

export interface ClassifierResult {
  blocked: boolean;
  reason: PrescribingReason | null;
  mode: ClassifierMode;
  matched: string | null;  // the token / phrase that triggered the block
}

const CHAT_CLASSIFIER_SYSTEM_PROMPT =
  'You are a strict binary classifier for clinical chat prompts. ' +
  'Return ONLY the string "BLOCK" or "ALLOW". ' +
  'Return BLOCK if the prompt asks the AI to prescribe, initiate, ' +
  'adjust, titrate, or discontinue a medication, OR if it specifies ' +
  'a dosage regimen. Return ALLOW for all other clinical questions ' +
  '(summaries, references, differential diagnosis discussions).';

// ── Regex fallback lists ────────────────────────────────────────────────
// Pattern: prescribing verbs that imply the AI is being asked to
// initiate / adjust / authorise medication. Kept narrow to avoid
// false positives on clinical summarisation ("patient was prescribed")
// vs. action requests ("prescribe sertraline").
const PRESCRIBING_VERBS = [
  /\b(prescribe|initiate|increase|decrease|titrate|wean|taper|switch)\b/i,
  /\b(start|stop|cease|discontinue)\b\s+\w+\s+(on|to|off)\b/i,
];

// Dosage instruction patterns — number + unit + "daily / bd / tds"
// etc. Matches "50 mg twice daily", "1 g TDS", "20mg bd".
const DOSAGE_PATTERNS = [
  /\b\d+\s?(mg|mcg|µg|g|ml|mL|IU|U)\b.*\b(daily|bd|tds|qid|qds|stat|prn|nocte|mane|qhs|q\d+h)\b/i,
  /\b(qid|tds|bd|mane|nocte|prn)\s+\d+\s?(mg|mcg|g|ml|IU|U)\b/i,
];

// Controlled drugs that require an authority prescription in AU.
// Case-insensitive, word-boundary to avoid partial matches.
const CONTROLLED_DRUGS = [
  'methylphenidate', 'dexamphetamine', 'lisdexamfetamine',
  'clonazepam', 'diazepam', 'lorazepam', 'alprazolam', 'midazolam',
  'temazepam', 'oxazepam', 'nitrazepam',
  'oxycodone', 'morphine', 'fentanyl', 'hydromorphone', 'methadone',
  'buprenorphine', 'tramadol',
  'clozapine',  // authority required, special monitoring
  'ketamine', 'dextroamphetamine',
];

function matchRegex(text: string): { reason: PrescribingReason; matched: string } | null {
  for (const re of PRESCRIBING_VERBS) {
    const m = text.match(re);
    if (m) return { reason: 'prescribing_verb', matched: m[0] };
  }
  for (const re of DOSAGE_PATTERNS) {
    const m = text.match(re);
    if (m) return { reason: 'dosage_instruction', matched: m[0] };
  }
  const lower = text.toLowerCase();
  for (const drug of CONTROLLED_DRUGS) {
    // Word boundaries — don't match inside "morphineic" etc.
    const re = new RegExp(`\\b${drug}\\b`, 'i');
    if (re.test(lower)) return { reason: 'controlled_drug_mention', matched: drug };
  }
  return null;
}

// ── Model-routed path ───────────────────────────────────────────────────
function classifierRequestedLocalModel(
  runtimeSelection: LockedAiRuntimeSelection,
): string | undefined {
  if (runtimeSelection.backend !== 'local_ollama') return undefined;
  const requestedModel = process.env.AI_CHAT_CLASSIFIER_MODEL?.trim();
  return requestedModel || undefined;
}

function parseModelClassifierAnswer(
  answer: string,
): { blocked: boolean; matched: string | null } | null {
  const normalized = answer.trim().toUpperCase();
  if (normalized.startsWith('BLOCK')) {
    return { blocked: true, matched: answer.trim().slice(0, 120) || 'BLOCK' };
  }
  if (normalized.startsWith('ALLOW')) {
    return { blocked: false, matched: null };
  }
  return null;
}

async function callLocalLlmClassifier(
  clinicId: string,
  text: string,
): Promise<{ blocked: boolean; matched: string | null } | null> {
  const runtimeSelection = await resolveLockedRuntimeSelection(clinicId);
  const prompt = `Prompt: ${text.slice(0, 2000)}\n\nAnswer:`;
  try {
    const response = await routeTextGeneration({
      clinicId,
      runtimeSelection,
      alias: 'fast_clinical',
      system: CHAT_CLASSIFIER_SYSTEM_PROMPT,
      prompt,
      temperature: 0,
      maxTokens: 12,
      requestedModel: classifierRequestedLocalModel(runtimeSelection),
      action: 'classifier',
      allowLocalStyleAdapter: false,
    });
    const parsed = parseModelClassifierAnswer(response.text);
    if (parsed) return parsed;
    logger.warn(
      {
        clinicId,
        runtimeBackend: runtimeSelection.backend,
        alias: response.execution.alias,
        modelName: response.execution.modelName,
        responsePreview: response.text.trim().slice(0, 120),
      },
      'chatClassifier: model-based classifier returned non-binary answer, falling back to regex',
    );
    return null;
  } catch (err) {
    logger.warn(
      {
        clinicId,
        err: err instanceof Error ? err.message : String(err),
        runtimeBackend: runtimeSelection.backend,
      },
      'chatClassifier: model-based classifier failed, falling back to regex',
    );
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────
/** Get the classifier mode for the clinic, defaulting to regex_keyword. */
export async function getClassifierMode(clinicId: string): Promise<ClassifierMode> {
  try {
    const row = await db('clinic_settings')
      .where({ clinic_id: clinicId })
      .select('ai_chat_classifier_mode')
      .first();
    const mode = row?.ai_chat_classifier_mode as ClassifierMode | undefined;
    return mode === 'local_llm' ? 'local_llm' : 'regex_keyword';
  } catch {
    return 'regex_keyword';
  }
}

export async function classifyForClinic(
  clinicId: string,
  text: string,
): Promise<ClassifierResult> {
  const mode = await getClassifierMode(clinicId);
  if (mode === 'local_llm') {
    const llm = await callLocalLlmClassifier(clinicId, text);
    if (llm) {
      return {
        blocked: llm.blocked,
        reason: llm.blocked ? 'model_flagged' : null,
        mode: 'local_llm',
        matched: llm.matched,
      };
    }
    // LLM unreachable → fall through to regex path rather than failing
    // open. Defensive posture: if classification can't be verified,
    // run the cheap deterministic check instead of letting the
    // prompt through.
  }
  const hit = matchRegex(text);
  return {
    blocked: !!hit,
    reason: hit?.reason ?? null,
    mode: 'regex_keyword',
    matched: hit?.matched ?? null,
  };
}

/** Exposed for unit tests + red-team harness. */
export const _internal = {
  matchRegex,
  parseModelClassifierAnswer,
  PRESCRIBING_VERBS,
  DOSAGE_PATTERNS,
  CONTROLLED_DRUGS,
};
