// apps/api/src/features/llm/llmRepository.ts
import { randomUUID } from 'crypto';
import { db } from '../../db/db';

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Matches LlmInteractionRow + real llm_interactions schema.
const LLM_INTERACTION_COLUMNS = [
  'id', 'clinic_id', 'user_id', 'patient_id', 'episode_id',
  'feature', 'model_name', 'model_version', 'model_provider',
  'prompt_tokens', 'completion_tokens', 'total_tokens', 'latency_ms',
  'success', 'error_code', 'input_ref', 'output_ref', 'metadata',
  'created_at', 'updated_at',
] as const;

/**
 * Mirrors `llm_interactions` exactly. Phase 0.7.5 c24 C7 (SD20) fixed
 * 7 ghost columns (staff_id, task_type, model_id, input_text,
 * draft_content, status, error_message). DB uses user_id, feature,
 * model_name, success, error_code, and carries total_tokens +
 * latency_ms + model_provider + input_ref + output_ref + metadata
 * as additional first-class columns. Every AI audit-log insert
 * crashed at runtime.
 *
 * BUG-424 — `model_version` is now surfaced through this row interface.
 * Closes the BUG-424 half of the prior partial-shape exemption: every
 * read path now sees the forensic-identity column, and the audit
 * helper writes it on every Whisper ASR + Ollama LLM row.
 *
 * @schema-drift-exempt partial-shape
 * BUG-540 — `embedding`, `temperature`, `pipeline` (LLM observability
 * roll-up) exist on the DB but are not yet surfaced. BUG-540 remains
 * the work item to flatten that residual projection.
 */
export interface LlmInteractionRow {
  id: string;
  clinic_id: string;
  user_id: string;
  patient_id: string | null;
  episode_id: string | null;
  feature: string;
  model_name: string;
  model_version: string | null;
  model_provider: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number | null;
  success: boolean;
  error_code: string | null;
  input_ref: string | null;
  output_ref: string | null;
  metadata: unknown | null;
  created_at: string;
  updated_at: string;
}

export interface LlmUsageDayRow {
  usage_date: string;
  feature: string;
  model_name: string;
  call_count: string;
  total_tokens_used: string;
  total_prompt_tokens: string;
  total_completion_tokens: string;
  avg_latency_ms: string | null;
  error_count: string;
}

export async function insertInteraction(
  data: Omit<LlmInteractionRow, 'id' | 'created_at' | 'updated_at'>,
): Promise<LlmInteractionRow> {
  const [row] = await db('llm_interactions')
    .insert({ id: randomUUID(), ...data, created_at: new Date(), updated_at: new Date() })
    .returning(LLM_INTERACTION_COLUMNS);
  return row as LlmInteractionRow;
}

export async function findInteractionById(
  clinicId: string,
  id: string,
): Promise<LlmInteractionRow | undefined> {
  return db('llm_interactions')
    .where({ id, clinic_id: clinicId })
    .first();
}

// Phase 0.7.5 c24 C7 — task_type/model_id/status were ghost columns.
// Now uses real columns (feature, model_name, success). avg_latency_ms
// sources the real latency_ms column; falls back to NULL where it
// wasn't captured.
const usageDaySelect = (q: ReturnType<typeof db>) =>
  q.select(
    db.raw(`DATE(created_at AT TIME ZONE 'Australia/Sydney') AS usage_date`),
    db.raw(`feature`),
    db.raw(`model_name`),
    db.raw('COUNT(*) AS call_count'),
    db.raw('COALESCE(SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0)), 0) AS total_tokens_used'),
    db.raw('COALESCE(SUM(prompt_tokens), 0) AS total_prompt_tokens'),
    db.raw('COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens'),
    db.raw('COALESCE(AVG(latency_ms)::int, NULL) AS avg_latency_ms'),
    db.raw(`COUNT(*) FILTER (WHERE success = false) AS error_count`),
  )
  .groupByRaw(`DATE(created_at AT TIME ZONE 'Australia/Sydney'), feature, model_name`)
  .orderByRaw(`DATE(created_at AT TIME ZONE 'Australia/Sydney'), feature, model_name`);

export async function listUsageByDay(
  clinicId: string,
  dateFrom: string,
  dateTo: string,
  userId?: string,
): Promise<LlmUsageDayRow[]> {
  const q = db('llm_interactions')
    .where('clinic_id', clinicId)
    .whereRaw(`DATE(created_at AT TIME ZONE 'Australia/Sydney') BETWEEN ? AND ?`, [dateFrom, dateTo]);
  if (userId) q.where('user_id', userId);
  return usageDaySelect(q) as unknown as Promise<LlmUsageDayRow[]>;
}

export async function listClinicUsageByDay(
  clinicId: string,
  dateFrom: string,
  dateTo: string,
): Promise<LlmUsageDayRow[]> {
  const q = db('llm_interactions')
    .where('clinic_id', clinicId)
    .whereRaw(`DATE(created_at AT TIME ZONE 'Australia/Sydney') BETWEEN ? AND ?`, [dateFrom, dateTo]);
  return usageDaySelect(q) as unknown as Promise<LlmUsageDayRow[]>;
}

export async function aggregateTotals(
  clinicId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{
  call_count: string;
  total_tokens_used: string;
  error_count: string;
  avg_latency_ms: string | null;
}> {
  const [row] = await db('llm_interactions')
    .where('clinic_id', clinicId)
    .whereRaw(`DATE(created_at AT TIME ZONE 'Australia/Sydney') BETWEEN ? AND ?`, [dateFrom, dateTo])
    .select(
      db.raw('COUNT(*) AS call_count'),
      db.raw('COALESCE(SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0)), 0) AS total_tokens_used'),
      db.raw(`COUNT(*) FILTER (WHERE success = false) AS error_count`),
      db.raw('COALESCE(AVG(latency_ms)::int, NULL) AS avg_latency_ms'),
    );
  return row as {
    call_count: string;
    total_tokens_used: string;
    error_count: string;
    avg_latency_ms: string | null;
  };
}
