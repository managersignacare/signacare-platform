// apps/api/src/shared/recordLlmInteraction.ts
//
// BUG-037 — canonical writer for the llm_interactions audit table.
//
// Pre-BUG-037, four call-sites wrote to llm_interactions with inconsistent
// column naming (model_name vs model_used vs model_id) and none recorded
// model_version / temperature / pipeline — so AI-assisted clinical outputs
// could not be reproduced for forensic review. This helper is the single
// source of truth for those four sites.
//
// Relationship to llmService.writeLlmInteraction:
//   - llmService.writeLlmInteraction (features/llm/llmService.ts:62) is the
//     HTTP endpoint handler for POST /api/v1/llm/interactions and returns a
//     response DTO. That path is retained and also stamps model_version via
//     ollamaModelRegistry. recordLlmInteraction is the SHARED internal
//     audit helper: fire-and-forget, called from non-HTTP and worker paths
//     (ambient scribe, /agent handler, training feedback, document
//     generation). Both ultimately insert into llm_interactions and both
//     call ollamaModelRegistry.getModelVersion() when a digest isn't
//     explicitly supplied — so Tier 4.4 weights identity is preserved on
//     every write regardless of entry point (L5 review absorption).
//
// Design constraints from 3-review cycle + L5 architectural review:
//   - model_version contract: digest-preferred via ollamaModelRegistry
//     (Tier 4.4 CRIT-G3 part 1); tag-fallback only when caller explicitly
//     supplies a non-digest string or Ollama is unreachable.
//   - temperature: REQUESTED value, not actual-runtime (Ollama doesn't
//     echo actual) (Review 3.2).
//   - Non-blocking for clinical flow: primary insert failure triggers a
//     structured logger.error + secondary writeAuditLog with
//     action='LLM_AUDIT_WRITE_FAILED' so audit-trail degradation is
//     observable per HIPAA 164.312(b) (Reviews 2.4 + 3.5). Reuses the
//     canonical writeAuditLog writer (L5 review absorption — no parallel
//     audit_log writer duplicating column-compat logic).
//   - PHI safety on metadata: validates against PHI_FIELDS set from the
//     BUG-216 logger redactor; rejects audit-table PHI spillage (Review 3.4).
//   - Uses dbAdmin: audit-table writes in this codebase consistently use
//     dbAdmin (see utils/audit.ts:154 writeAuditLog). Worker contexts have
//     no RLS scope; request contexts with dbAdmin are safe because every
//     row carries clinic_id explicitly (same pattern as writeAuditLog +
//     BUG-238 HL7 worker).

import { randomUUID } from 'crypto';
import { dbAdmin } from '../db/db';
import { logger } from '../utils/logger';
import { PHI_FIELDS } from '../utils/phiFields';
import { writeAuditLog } from '../utils/audit';
// BUG-282 — encrypted PHI-isolation for LLM prompt+output text.
// When caller supplies promptText + outputText, both are encrypted
// via AES-256-GCM and inserted into llm_prompts_outputs inside the
// SAME transaction as the llm_interactions row. If encryptPhi fails
// (PHI_ENCRYPTION_KEY absent OR cipher error), write NULL ciphertext
// + encryption_status='FAILED' instead of plaintext — invariant from
// A-4 plan's R1 absorption (NEVER plaintext in *_encrypted columns).
import { encryptPhi, isPhiEncryptionEnabled } from './phiEncryption';
import type { PipelineStage } from './pipelineTracker';

export interface RecordLlmInteractionArgs {
  /** Clinic ID (tenant). Required. */
  clinicId: string;
  /** Staff ID who initiated the interaction. Optional for system-agent paths. */
  userId?: string;
  /** Patient ID when the interaction is patient-scoped. Optional. */
  patientId?: string | null;
  /** Episode ID when bound to an episode. Optional. */
  episodeId?: string | null;
  /** Feature name (e.g. 'ambient', 'ai-agent', 'document', 'training-feedback'). */
  feature: string;
  /** Model name — the tag/identifier (e.g. 'llama3:70b'). */
  modelName: string;
  /** Immutable model version — digest preferred; tag acceptable fallback. */
  modelVersion?: string;
  /** Provider — 'ollama' | 'huggingface' | 'openai' | etc. */
  modelProvider?: string;
  /** REQUESTED temperature (0–2). Runtime temperature isn't echoed by providers. */
  temperature?: number;
  /** Ordered pipeline stages from PipelineTracker.toJSON(). */
  pipeline?: PipelineStage[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  success?: boolean;
  errorCode?: string;
  /**
   * Free-form metadata JSONB. MUST NOT contain raw PHI (names, addresses,
   * medicare numbers, phone, email, DOB, etc.). Use aggregated / derived
   * values (counts, booleans, hashes) instead.
   *
   * Validation matches PipelineTracker.meta rules but is enforced here
   * too because some call-sites (e.g. trainingPipeline) pass metadata
   * directly without going through the tracker.
   */
  metadata?: Record<string, unknown>;
  /**
   * BUG-282 — raw LLM prompt text. When supplied alongside outputText,
   * both are AES-256-GCM-encrypted and inserted into llm_prompts_outputs
   * inside the SAME transaction as the llm_interactions row. The
   * llm_interactions row lands atomically with the prompt+output row.
   *
   * On encryption failure OR PHI_ENCRYPTION_KEY absent: ciphertext
   * columns receive NULL (NEVER plaintext), encryption_status='FAILED',
   * structured logger.error emitted. Parent llm_interactions INSERT
   * always succeeds — clinical-flow continuity wins over PHI-companion
   * availability. Training/export pipelines filter
   * WHERE encryption_status='ENCRYPTED' to exclude FAILED rows
   * machine-checkably (not by convention).
   *
   * Optional: legacy callers (not yet migrated per BUG-342) skip this
   * arg and the legacy single-INSERT path is taken. Migration of every
   * caller is BUG-342 follow-up.
   */
  promptText?: string;
  /** BUG-282 — raw LLM output text (paired with promptText). */
  outputText?: string;
  /**
   * BUG-282 — scribe_consents.id when the LLM call was recording-bound.
   * NULL for general-purpose prompts (classify, agent tools with no
   * patient context). Training-export path filters on consent_id IS
   * NOT NULL + consent-is-training-authorised.
   */
  consentId?: string | null;
}

/**
 * Keys that historically carried raw LLM text in metadata JSONB.
 * BUG-342 migrated all known callers to the new promptText/outputText
 * args (which land in the encrypted llm_prompts_outputs table — BUG-282).
 * This list is the runtime guard that prevents a future caller from
 * re-introducing raw text via metadata. Adding a new key to this list
 * requires updating every caller that emits it.
 */
const FORBIDDEN_METADATA_RAW_TEXT_KEYS = new Set<string>([
  'inputText',
  'outputText',
  'aiOutput',
  'prompt',
  'output',
  'rawText',
  'transcript',
  'answer',
  'promptText',
]);

/**
 * Reject metadata keys matching PHI_FIELDS or raw-text keys. Raw text
 * belongs in the encrypted llm_prompts_outputs table via promptText +
 * outputText args — BUG-342 caller migration invariant.
 */
function assertMetadataPhiSafe(metadata: unknown, context: string): void {
  if (metadata === undefined || metadata === null) return;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return; // helper is lenient on shape; only PHI key/values matter
  const obj = metadata as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (PHI_FIELDS.has(key)) {
      throw new Error(
        `[BUG-037] recordLlmInteraction metadata key '${key}' matches a PHI field name. ` +
          `Audit table MUST NOT carry PHI (see BUG-216 redactor scope). Context: ${context}.`,
      );
    }
    if (FORBIDDEN_METADATA_RAW_TEXT_KEYS.has(key)) {
      throw new Error(
        `[BUG-342] recordLlmInteraction metadata key '${key}' is forbidden — ` +
          `raw LLM prompt/output text must be passed via promptText + outputText args ` +
          `(written to the encrypted llm_prompts_outputs table per BUG-282). ` +
          `Context: ${context}.`,
      );
    }
  }
}

/**
 * Write one row to llm_interactions. Non-blocking: primary insert failure
 * logs + writes a best-effort secondary audit_log row with operation
 * 'LLM_AUDIT_WRITE_FAILED' so operators can detect degraded audit trail.
 *
 * Returns the UUID of the written row. On primary insert failure returns
 * the attempted id anyway so callers can still correlate with the secondary
 * audit_log entry if they need to.
 *
 * Callers may await for ordering guarantees (tests + FK dependents like
 * ai_training_feedback) or fire-and-forget in hot paths (all .catch() is
 * internal; unhandled rejections are impossible).
 */
export async function recordLlmInteraction(args: RecordLlmInteractionArgs): Promise<string> {
  // Validate metadata PHI-safety BEFORE attempting insert — caller bug
  // (passing transcript text as metadata) should surface loudly in dev,
  // not silently poison production audit tables.
  assertMetadataPhiSafe(args.metadata, args.feature);

  // L5 review absorption — Tier 4.4 CRIT-G3 part 1: stamp model_version
  // via ollamaModelRegistry which queries /api/show for the manifest
  // digest and returns `name@sha256:digest`. Falls back to `name@unknown`
  // when Ollama is unreachable (graceful degradation — clinical flow
  // never blocked on Ollama availability).
  //
  // BUG-424 absorb-1 — provider-aware resolution. Pre-BUG-424, this
  // helper assumed every caller was Ollama-shaped and always routed
  // through ollamaModelRegistry, silently overwriting non-Ollama
  // pre-resolved versions. Whisper pre-resolves via whisperClient
  // (`<name>@sha256:<digest>` or `<name>@unknown`); future providers
  // (Azure speech, Whisper-MLX, etc.) will pre-resolve via their own
  // registries. The discriminator is `args.modelProvider`: when set
  // and != 'ollama', the caller-supplied modelVersion is honoured
  // verbatim. Bare-digest path (`sha256:<hex>`) is preserved for
  // tests + legacy callers.
  let resolvedModelVersion: string | null;
  const callerPreResolved =
    typeof args.modelVersion === 'string'
    && (args.modelVersion.startsWith('sha256:')
      || (typeof args.modelProvider === 'string' && args.modelProvider !== 'ollama' && args.modelProvider.length > 0));
  if (callerPreResolved) {
    resolvedModelVersion = args.modelVersion as string;
  } else {
    try {
      const { ollamaModelRegistry } = await import('../mcp/ollamaModelRegistry');
      resolvedModelVersion = await ollamaModelRegistry.getModelVersion(args.modelName);
    } catch (err) {
      // Registry unreachable (shouldn't happen — registry itself has
      // graceful fallback). Honour the caller-supplied tag or null.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), modelName: args.modelName },
        '[BUG-037] ollamaModelRegistry.getModelVersion failed — falling back to caller-supplied tag',
      );
      resolvedModelVersion = args.modelVersion ?? null;
    }
  }

  const rowId = randomUUID();
  const row: Record<string, unknown> = {
    id: rowId,
    clinic_id: args.clinicId,
    user_id: args.userId ?? null,
    patient_id: args.patientId ?? null,
    episode_id: args.episodeId ?? null,
    feature: args.feature,
    model_name: args.modelName,
    model_version: resolvedModelVersion,
    model_provider: args.modelProvider ?? null,
    temperature: args.temperature ?? null,
    pipeline: args.pipeline ? JSON.stringify(args.pipeline) : null,
    prompt_tokens: args.promptTokens ?? null,
    completion_tokens: args.completionTokens ?? null,
    total_tokens: args.totalTokens ?? null,
    latency_ms: args.latencyMs ?? null,
    success: args.success ?? true,
    error_code: args.errorCode ?? null,
    metadata: args.metadata ? JSON.stringify(args.metadata) : null,
    created_at: new Date(),
  };

  // BUG-282 — when caller supplies both promptText + outputText, the
  // llm_interactions INSERT and the llm_prompts_outputs INSERT must
  // land atomically (invariant: no forensic half-state). Use a
  // dbAdmin.transaction. Encryption failure is NOT a rollback trigger
  // — the row still lands, with NULL ciphertext + encryption_status=
  // 'FAILED'. Only non-encryption failures (FK violation, unique
  // conflict, connection loss) abort the transaction.
  const writeBoth = typeof args.promptText === 'string' && typeof args.outputText === 'string';

  /**
   * Safely encrypt a plaintext string for the llm_prompts_outputs
   * table. Returns {ciphertext, failed} — failed=true when encryption
   * couldn't produce a ciphertext OR the PHI encryption key isn't
   * configured. Callers write NULL + status='FAILED' when failed=true;
   * NEVER write the fallback plaintext to a *_encrypted column.
   *
   * Detection: a successful AES-256-GCM ciphertext from encryptPhi is
   * `iv:tag:ciphertext` (three colon-separated base64 chunks). The
   * dev fallback returns the plaintext unchanged. We detect the
   * 3-part shape + presence of PHI_ENCRYPTION_KEY both — belt-and-
   * suspenders against future fallback-return-shape changes.
   */
  const tryEncrypt = (plaintext: string, fieldName: string): { ciphertext: string | null; failed: boolean } => {
    if (!isPhiEncryptionEnabled()) return { ciphertext: null, failed: true };
    try {
      const out = encryptPhi(plaintext);
      const tokenCount = out ? out.split(':').length : 0;
      if (!out || (tokenCount !== 3 && tokenCount !== 4) || out === plaintext) {
        // Unexpected shape or obvious passthrough — treat as failure.
        return { ciphertext: null, failed: true };
      }
      return { ciphertext: out, failed: false };
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), field: fieldName, recordId: rowId, feature: args.feature },
        '[BUG-282] encryptPhi failed — writing FAILED sentinel instead of plaintext',
      );
      return { ciphertext: null, failed: true };
    }
  };

  try {
    if (writeBoth) {
      const promptResult = tryEncrypt(args.promptText as string, 'prompt');
      const outputResult = tryEncrypt(args.outputText as string, 'output');
      const status = promptResult.failed || outputResult.failed ? 'FAILED' : 'ENCRYPTED';
      if (status === 'FAILED') {
        logger.error(
          {
            recordId: rowId,
            feature: args.feature,
            reason: !isPhiEncryptionEnabled() ? 'PHI_ENCRYPTION_KEY absent' : 'cipher error',
            promptFailed: promptResult.failed,
            outputFailed: outputResult.failed,
          },
          '[BUG-282] llm_prompts_outputs row will be marked FAILED — ciphertext columns set to NULL (clinical flow preserved)',
        );
      }
      await dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [args.clinicId]);
        if (args.userId) {
          await trx.raw("SELECT set_config('app.user_id', ?, true)", [args.userId]);
        }
        await trx('llm_interactions').insert(row);
        await trx('llm_prompts_outputs').insert({
          id: randomUUID(),
          llm_interaction_id: rowId,
          // Invariant: if either encryption failed, BOTH ciphertext
          // columns get NULL. Conservative — never half-cipher.
          prompt_encrypted: status === 'FAILED' ? null : promptResult.ciphertext,
          output_encrypted: status === 'FAILED' ? null : outputResult.ciphertext,
          encryption_status: status,
          consent_id: args.consentId ?? null,
          created_at: new Date(),
        });
      });
    } else {
      await dbAdmin.transaction(async (trx) => {
        await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [args.clinicId]);
        if (args.userId) {
          await trx.raw("SELECT set_config('app.user_id', ?, true)", [args.userId]);
        }
        await trx('llm_interactions').insert(row);
      });
    }
  } catch (primaryErr) {
    // Failure path (Reviews 2.4 + 3.5 + L5 absorption): non-blocking but
    // observable. Reuses the canonical writeAuditLog writer rather than
    // inlining an audit_log insert so column-compat + UUID-safety logic
    // lives in exactly one place.
    logger.error(
      {
        err: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
        clinicId: args.clinicId,
        feature: args.feature,
        modelName: args.modelName,
      },
      '[BUG-037] llm_interactions primary insert failed — writing secondary audit_log entry',
    );
    // writeAuditLog never throws; on its own failure it logger.errors
    // internally and swallows. BUG-283 tracks Redis outbox for
    // the rare case where both DB writes are unreachable.
    await writeAuditLog({
      clinicId: args.clinicId,
      actorId: args.userId ?? '',
      action: 'LLM_AUDIT_WRITE_FAILED',
      tableName: 'llm_interactions',
      recordId: rowId,
      newValues: {
        feature: args.feature,
        modelName: args.modelName,
        failureReason: primaryErr instanceof Error ? primaryErr.message.slice(0, 500) : 'unknown',
      },
    });
  }
  return rowId;
}
