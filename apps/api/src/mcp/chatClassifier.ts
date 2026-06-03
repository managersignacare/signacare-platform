// apps/api/src/mcp/chatClassifier.ts
//
// Audit Tier 5.3 — AI Chat classifier (dual-mode).
//
// User direction (2026-04-19): BOTH modes must be supported:
//
//   - regex_keyword  — fast, deterministic. Matches prescribing verbs,
//     dosage units, and controlled-drug names. No model call. Safe
//     fallback; 10-50ms budget.
//   - local_llm      — single-turn Ollama call with a structured
//     prompt, more accurate on natural-language prompts but slower
//     (200-800ms). Requires `chat-classifier-v1` Ollama model.
//
// Per-clinic mode is stored on clinic_settings.ai_chat_classifier_mode.
// Callers use `classifyForClinic(clinicId, text)` which reads the
// clinic's configured mode, dispatches accordingly, and returns a
// normalised result. A classifier hit (`reason` ∈ PRESCRIBING_REASONS)
// MUST be rejected by the calling handler + audit-logged.

import logger from '../utils/logger';
import { config } from '../config/config';
import { db } from '../db/db';

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

// ── Local LLM path ──────────────────────────────────────────────────────
async function callLocalLlmClassifier(text: string): Promise<{ blocked: boolean; matched: string | null } | null> {
  const baseUrl = config.ollama?.baseUrl ?? 'http://localhost:11434';
  const model = process.env.AI_CHAT_CLASSIFIER_MODEL ?? 'llama3.2:3b';
  const prompt =
    'You are a strict binary classifier for clinical chat prompts. ' +
    'Return ONLY the string "BLOCK" or "ALLOW". ' +
    'Return BLOCK if the prompt asks the AI to prescribe, initiate, ' +
    'adjust, titrate, or discontinue a medication, OR if it specifies ' +
    'a dosage regimen. Return ALLOW for all other clinical questions ' +
    '(summaries, references, differential diagnosis discussions).\n\n' +
    `Prompt: ${text.slice(0, 2000)}\n\nAnswer:`;
  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    const answer = (data.response ?? '').trim().toUpperCase();
    if (answer.startsWith('BLOCK')) return { blocked: true, matched: answer.slice(0, 120) };
    return { blocked: false, matched: null };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'chatClassifier: local_llm call failed, falling back to regex',
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
    const llm = await callLocalLlmClassifier(text);
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
export const _internal = { matchRegex, PRESCRIBING_VERBS, DOSAGE_PATTERNS, CONTROLLED_DRUGS };
