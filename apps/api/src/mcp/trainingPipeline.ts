/**
 * AI Training Pipeline
 *
 * 4 levels of LLM improvement:
 *
 * LEVEL 1: Prompt Engineering (immediate)
 *   - Refined system prompts with few-shot examples
 *   - Already implemented in aiEnhancer.ts
 *
 * LEVEL 2: Feedback Collection (this file)
 *   - Captures: AI output, user edits, ratings
 *   - Every edit = training example (input → preferred output)
 *   - Exports as JSONL for fine-tuning
 *
 * LEVEL 3: RAG Tuning
 *   - Improve context retrieval (loadPatientContext)
 *   - Custom embedding model for clinical text similarity
 *
 * LEVEL 4: Fine-Tuning (LoRA/QLoRA)
 *   - Train adapter weights on collected feedback data
 *   - Merge into base model via Ollama Modelfile
 *   - See: models/fine-tune/README.md
 */

import { randomUUID } from 'crypto';
import { db } from '../db/db';
import { logger } from '../utils/logger';
import { recordLlmInteraction } from '../shared/recordLlmInteraction';

// Narrow a Knex count/avg row (typed as `any` by default) to the
// specific shape returned by .count('* as cnt') or .avg('col as avg').
interface CountRow { cnt: number | string }
interface AvgRow { avg: number | string | null }
const asCount = (r: unknown): number => {
  const cnt = (r as CountRow | undefined)?.cnt;
  return typeof cnt === 'number' ? cnt : typeof cnt === 'string' ? parseInt(cnt, 10) || 0 : 0;
};

// ── Feedback Collection ──

export interface AiFeedback {
  clinicId: string;
  staffId: string;
  action: string;             // maudsley, isbar, formulation, etc.
  modelUsed: string;
  inputText: string;          // What was sent to the LLM
  aiOutput: string;           // Raw LLM output
  userEditedOutput?: string;  // What the user changed it to
  wasAccepted: boolean;       // Used without edits
  wasEdited: boolean;         // User modified the output
  rating?: number;            // 1-5 star rating
  feedbackNotes?: string;     // Optional text feedback
  patientId?: string;
}

export async function saveFeedback(feedback: AiFeedback): Promise<string> {
  const feedbackId = randomUUID();
  try {
    // R2 baseline split this into TWO tables: llm_interactions records the AI
    // call itself (who called, what feature, which model, patient context) and
    // ai_training_feedback records the clinician's reaction to that interaction
    // (accepted/edited, rating, comments, corrected output).
    //
    // BUG-037 — canonical audit write via recordLlmInteraction. The helper
    // returns the interaction row id so ai_training_feedback.interaction_id
    // can FK it directly.
    //
    // Note: historical code carried full prompt + AI output in
    // llm_interactions.metadata for fine-tuning export. This is PHI-laden on
    // clinical features and violates the "metadata must be derived-only"
    // rule in the BUG-037 contract. BUG-282 tracks migrating raw-text
    // envelopes into a separate encrypted prompts/outputs table. Until then
    // this helper records only aggregates (lengths) in metadata, and the
    // raw text lives on ai_training_feedback.original_output/corrected_output
    // where consent-gated export semantics already apply.
    const interactionId = await recordLlmInteraction({
      clinicId: feedback.clinicId,
      userId: feedback.staffId,
      patientId: feedback.patientId ?? null,
      feature: feedback.action,
      modelName: feedback.modelUsed ?? 'unknown',
      modelVersion: feedback.modelUsed ?? 'unknown', // tag-fallback; BUG-282 tracks digest recovery for post-hoc feedback
      success: true,
      // BUG-342 — raw inputText + aiOutput move from metadata JSONB
      // (which was length-only since BUG-037) into the encrypted
      // llm_prompts_outputs table (BUG-282). Post-hoc feedback is
      // NOT recording-bound (user fills a form after the fact) so
      // consentId is null; training-export filter excludes NULL-
      // consent rows. The ai_training_feedback table still carries
      // original_output + corrected_output for the feedback-specific
      // training-corpus path (its own consent semantics apply).
      promptText: feedback.inputText,
      outputText: feedback.aiOutput,
      consentId: null,
      metadata: {
        inputTextLen: feedback.inputText.length,
        aiOutputLen: feedback.aiOutput.length,
        versionSource: 'tag',
        postHoc: true,
      },
    });
    const feedbackType = feedback.wasAccepted ? 'accepted' : feedback.wasEdited ? 'edited' : 'rated';
    await db('ai_training_feedback').insert({
      id: feedbackId,
      clinic_id: feedback.clinicId,
      staff_id: feedback.staffId,
      interaction_id: interactionId,
      feedback_type: feedbackType,
      rating: feedback.rating ?? null,
      comments: feedback.feedbackNotes ?? null,
      original_output: feedback.aiOutput,
      corrected_output: feedback.userEditedOutput ?? null,
    });
    logger.info({ id: feedbackId, interactionId, action: feedback.action, wasEdited: feedback.wasEdited }, '[Training] Feedback saved');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[Training] Failed to save feedback');
  }
  return feedbackId;
}

// ── Training Data Export ──

export interface TrainingExample {
  instruction: string;    // System prompt / task description
  input: string;          // User input (clinical data)
  output: string;         // Preferred output (user-edited version)
  action: string;
  model: string;
  rating?: number;
}

/**
 * Export collected feedback as JSONL training data.
 * Only exports examples where the user edited the output (= corrections)
 * or rated 4-5 stars (= good examples).
 *
 * JOINs `llm_interactions` to recover the `feature` (action) and
 * `model_name`. A matching encrypted `llm_prompts_outputs` row with a
 * non-null consent_id is mandatory; post-hoc/null-consent feedback is never
 * exported into adapter/fine-tuning corpora.
 */
interface ExportRow {
  feedback_type: string | null;
  rating: number | null;
  original_output: string | null;
  corrected_output: string | null;
  feature: string | null;
  model_name: string | null;
  metadata: { inputText?: string; aiOutput?: string } | null;
}

export async function exportTrainingData(clinicId: string): Promise<TrainingExample[]> {
  const rows = await db('ai_training_feedback as atf')
    .leftJoin('llm_interactions as lli', 'lli.id', 'atf.interaction_id')
    .innerJoin('llm_prompts_outputs as lpo', 'lpo.llm_interaction_id', 'lli.id')
    .where('atf.clinic_id', clinicId)
    .whereNotNull('lpo.consent_id')
    .where('lpo.encryption_status', 'ENCRYPTED')
    .where(function () {
      this.whereNotNull('atf.corrected_output')       // User corrections
        .orWhere('atf.rating', '>=', 4)               // High-rated outputs
        .orWhere('atf.feedback_type', 'accepted');    // Accepted without change
    })
    .orderBy('atf.created_at', 'desc')
    .limit(5000)
    .select(
      'atf.feedback_type',
      'atf.rating',
      'atf.original_output',
      'atf.corrected_output',
      'lli.feature',
      'lli.model_name',
      'lli.metadata',
    ) as unknown as ExportRow[];

  const SYSTEM_PROMPTS: Record<string, string> = {
    maudsley: 'Generate a Maudsley format longitudinal psychiatric summary.',
    isbar: 'Generate an ISBAR clinical handover summary.',
    formulation: 'Generate a biopsychosocial formulation using the 4P framework.',
    '91day': 'Generate a 91-day review summary for a mental health patient.',
    letter: 'Generate a professional clinical letter.',
    discharge: 'Generate a comprehensive discharge summary.',
    'med-summary': 'Summarise medication history and changes.',
    ambient: 'Convert ambient clinical notes into structured SOAP format.',
  };

  return rows.map((r) => {
    const action = r.feature ?? 'other';
    const inputText = r.metadata?.inputText ?? '';
    // Prefer clinician-corrected version; fall back to original AI output
    // (this row was included because rating >= 4 or feedback_type='accepted').
    const output = r.corrected_output ?? r.original_output ?? r.metadata?.aiOutput ?? '';
    return {
      instruction: SYSTEM_PROMPTS[action] ?? `Perform clinical AI task: ${action}`,
      input: inputText,
      output,
      action,
      model: r.model_name ?? 'unknown',
      rating: r.rating ?? undefined,
    };
  });
}

/**
 * Export as JSONL (JSON Lines) format for fine-tuning tools.
 * Compatible with: Unsloth, Axolotl, LLaMA-Factory, OpenAI fine-tuning.
 */
export function toJsonl(examples: TrainingExample[]): string {
  return examples.map(ex => JSON.stringify({
    // Alpaca format (most widely supported)
    instruction: ex.instruction,
    input: ex.input.substring(0, 4000),  // Truncate for training
    output: ex.output.substring(0, 4000),
  })).join('\n');
}

/**
 * Export as ChatML format (for chat-tuned models like Qwen, Mistral).
 */
export function toChatMl(examples: TrainingExample[]): string {
  return examples.map(ex => JSON.stringify({
    messages: [
      { role: 'system', content: ex.instruction },
      { role: 'user', content: ex.input.substring(0, 4000) },
      { role: 'assistant', content: ex.output.substring(0, 4000) },
    ],
  })).join('\n');
}

// ── Training Statistics ──

export async function getTrainingStats(clinicId: string): Promise<{
  totalFeedback: number;
  edited: number;
  accepted: number;
  avgRating: number | null;
  byAction: Record<string, { count: number; editRate: number }>;
  readyForTraining: number;
}> {
  const [total] = await db('ai_training_feedback').where({ clinic_id: clinicId }).count('* as cnt');
  // edited = there's a clinician-written corrected_output on the feedback row.
  const [edited] = await db('ai_training_feedback')
    .where('clinic_id', clinicId)
    .whereNotNull('corrected_output')
    .count('* as cnt');
  // accepted = feedback_type enum set to 'accepted' (clinician used the AI output as-is).
  const [accepted] = await db('ai_training_feedback')
    .where({ clinic_id: clinicId, feedback_type: 'accepted' })
    .count('* as cnt');
  const [avgRow] = await db('ai_training_feedback').where({ clinic_id: clinicId }).whereNotNull('rating').avg('rating as avg');

  // byAction breakdown: group by the JOINed llm_interactions.feature (the
  // 'action' field was never on ai_training_feedback in the baseline; feature
  // lives on the interaction row that triggered the feedback).
  const byActionRows = await db('ai_training_feedback as atf')
    .leftJoin('llm_interactions as lli', 'lli.id', 'atf.interaction_id')
    .where('atf.clinic_id', clinicId)
    .groupBy('lli.feature')
    .select(
      'lli.feature as feature',
      db.raw('COUNT(*) as cnt'),
      db.raw('SUM(CASE WHEN atf.corrected_output IS NOT NULL THEN 1 ELSE 0 END) as edited_cnt'),
    ) as unknown as Array<{ feature: string | null; cnt: string | number; edited_cnt: string | number }>;

  const byAction: Record<string, { count: number; editRate: number }> = {};
  for (const r of byActionRows) {
    const key = r.feature ?? 'other';
    const count = typeof r.cnt === 'number' ? r.cnt : parseInt(r.cnt, 10);
    const editedCnt = typeof r.edited_cnt === 'number' ? r.edited_cnt : parseInt(r.edited_cnt, 10);
    byAction[key] = {
      count,
      editRate: count > 0 ? editedCnt / count : 0,
    };
  }

  const editedCount = asCount(edited);
  const acceptedCount = asCount(accepted);
  const readyForTraining = editedCount + acceptedCount;
  const avgVal = (avgRow as AvgRow | undefined)?.avg;
  const avgRating = typeof avgVal === 'number' ? avgVal : typeof avgVal === 'string' ? parseFloat(avgVal) : null;

  return {
    totalFeedback: asCount(total),
    edited: editedCount,
    accepted: acceptedCount,
    avgRating,
    byAction,
    readyForTraining,
  };
}
