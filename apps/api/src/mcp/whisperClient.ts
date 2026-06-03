// apps/api/src/mcp/whisperClient.ts
//
// BUG-424 — single source of truth for the Whisper ASR forensic-identity
// + audit-write path.
//
// Why this exists.
// Whisper transcribes ambient consultations whose output drives the
// scribe-generated clinical note. If the underlying weights are silently
// swapped (operator upgrades, .pt file rebuild, fork rollback) and we
// have no audit row identifying which weights produced which transcript,
// coronial review of "the wrong drug name was transcribed" has no path
// to find which version was active. CLAUDE.md §6.3 + Audit Tier 4.4
// CRIT-G3 require model-version capture on every AI-assisted clinical
// artefact.
//
// What this file does.
// 1. `getWhisperModelVersion()` — single SSoT probe. Calls the local
//    Whisper server's `/health` endpoint, caches `name@sha256:digest`
//    in module scope. Graceful fallback to `name@unknown` sentinel when
//    /health is unreachable so a network blip does NOT kill the audit
//    write — degraded forensic identity is better than no row at all.
// 2. `recordWhisperAsrInteraction(args)` — wraps `recordLlmInteraction`
//    with `feature='ambient.asr'` + `modelProvider='whisper'`. Forces
//    `modelVersion` to be REQUIRED (TS type) and runtime-validates the
//    shape — fail-CLOSED with `WHISPER_MODEL_VERSION_MISSING` if absent
//    or malformed. Caller cannot forget to record the version because
//    omitting `modelVersion` is a compile error AND a runtime throw.
//
// L5 absorb-1 narrowing — current SSoT scope.
// `recordWhisperAsrInteractionSafely` is the canonical write-helper for
// the ambient pipeline (apps/api/src/mcp/ambientProcessor.ts) ONLY.
// Three other Whisper /inference callers exist that have NOT yet been
// migrated to this helper and currently emit no ASR audit row:
//   - apps/api/src/features/roles/psychiatristFeatureRoutes.ts
//     `/voice/quick-memo` — tracked as BUG-424b cascade.
//   - apps/api/src/mcp/scribeStreaming.ts — tracked as BUG-424c.
//   - apps/api/src/features/llm/streamingTranscribeRoutes.ts (which
//     additionally posts to a non-existent /transcribe path) —
//     tracked as BUG-424c (streaming partial-transcript audit class).
// A future contributor reading "SSoT for Whisper ASR" should NOT
// assume universal coverage until those cascades close.
//
// What this file deliberately does NOT do.
// - Does NOT enforce a "minimum approved Whisper version" policy. That
//   belongs in a future model_registry table (Tier 19.10 follow-up).
//   This file's job is recording, not gate-keeping.
// - Does NOT scrub PHI from the transcript. PHI handling for ambient
//   live in `recordLlmInteraction` + `llm_prompts_outputs` (BUG-282).
//
// fix-registry anchors:
//   R-FIX-WHISPER-VERSION-PIN — fail-CLOSED on missing modelVersion
//   R-FIX-WHISPER-ASR-FEATURE — feature='ambient.asr' is the canonical
//     write-feature for Whisper rows (separate from Ollama 'ambient')

import { logger } from '../utils/logger';
import { recordLlmInteraction } from '../shared/recordLlmInteraction';
import type { PipelineStage } from '../shared/pipelineTracker';

// ── Constants + types ──────────────────────────────────────────────────────

const WHISPER_HEALTH_URL = `${process.env.WHISPER_API_URL ?? 'http://localhost:8080'}/health`;

const WHISPER_MODEL_NAME_DEFAULT = process.env.WHISPER_MODEL ?? 'large-v3-turbo';

/**
 * Canonical model_version shape for Whisper ASR rows.
 *
 *   `<name>@sha256:<64hex>` — fully-resolved (preferred)
 *   `<name>@unknown`        — graceful fallback when /health was
 *                             unreachable at probe time
 *
 * Bare `sha256:<digest>` and bare names are NOT accepted because they
 * lose the model-family identifier that lets a forensic reviewer
 * distinguish `large-v3-turbo` from `medium.en` etc.
 *
 * Pattern is exported so the integration-test contract gate can also
 * reuse it.
 */
export const WHISPER_MODEL_VERSION_PATTERN = /^[a-zA-Z0-9._\-:]+@(sha256:[a-f0-9]{64}|unknown)$/;

interface WhisperHealthResponse {
  status?: string;
  model?: string;
  model_version?: string;
  loaded?: boolean;
  device?: string;
}

export interface RecordWhisperAsrInteractionArgs {
  /** Clinic ID (tenant). Required. */
  clinicId: string;
  /** Staff ID who initiated the recording. Optional for system paths. */
  userId?: string;
  /** Patient ID when the recording is patient-scoped. */
  patientId?: string | null;
  /** Episode ID when bound to an episode. */
  episodeId?: string | null;
  /** Whisper model tag (e.g. `large-v3-turbo`). */
  modelName: string;
  /**
   * Whisper model version. REQUIRED. Must match
   * WHISPER_MODEL_VERSION_PATTERN. Throws WHISPER_MODEL_VERSION_MISSING
   * fail-CLOSED if absent or malformed — silent capture of an ASR
   * artefact without forensic identity is forbidden.
   */
  modelVersion: string;
  /** Ordered pipeline stages (Whisper inference + diarization timing). */
  pipeline?: PipelineStage[];
  /** Audio duration in seconds → captured as completion_tokens proxy. */
  durationSeconds?: number;
  latencyMs?: number;
  success?: boolean;
  errorCode?: string;
  /** Free-form metadata JSONB. PHI-safe per recordLlmInteraction validators. */
  metadata?: Record<string, unknown>;
}

// ── Module-scope cache for /health probe ──────────────────────────────────

let cachedVersion: string | null = null;
let inflight: Promise<string> | null = null;

/**
 * Test-only reset hook. Production callers must NEVER use this; the cache
 * is intentionally module-scoped so a long-running process probes /health
 * exactly once per boot and reuses the digest for every subsequent ASR
 * row.
 */
export function __testReset(): void {
  cachedVersion = null;
  inflight = null;
}

/**
 * Returns the canonical Whisper `name@sha256:digest` (or `name@unknown`
 * graceful sentinel) for the running Whisper server. Cached after first
 * successful probe.
 *
 * Graceful degradation: if /health is unreachable OR the response omits
 * `model_version` (older server build), returns `<name>@unknown` and
 * logs a structured WARN. The audit row still lands so the recording is
 * NOT lost — the trade-off is degraded forensic identity over no record
 * at all.
 */
export async function getWhisperModelVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  if (inflight) return inflight;

  inflight = (async (): Promise<string> => {
    try {
      const res = await fetch(WHISPER_HEALTH_URL);
      if (!res.ok) {
        logger.warn(
          { status: res.status, url: WHISPER_HEALTH_URL },
          '[whisperClient] /health non-200 — falling back to @unknown sentinel',
        );
        return `${WHISPER_MODEL_NAME_DEFAULT}@unknown`;
      }
      const data = (await res.json()) as WhisperHealthResponse;
      const name = data.model ?? WHISPER_MODEL_NAME_DEFAULT;
      const version = data.model_version;
      if (typeof version === 'string' && WHISPER_MODEL_VERSION_PATTERN.test(version)) {
        return version;
      }
      logger.warn(
        { name, version, url: WHISPER_HEALTH_URL },
        '[whisperClient] /health did not return a well-formed model_version — falling back to @unknown sentinel (older server build?)',
      );
      return `${name}@unknown`;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), url: WHISPER_HEALTH_URL },
        '[whisperClient] /health probe threw — falling back to @unknown sentinel',
      );
      return `${WHISPER_MODEL_NAME_DEFAULT}@unknown`;
    }
  })();

  try {
    const v = await inflight;
    cachedVersion = v;
    return v;
  } finally {
    inflight = null;
  }
}

/**
 * Write a single `llm_interactions` audit row for an ASR (Whisper)
 * inference. SSoT — every Whisper ASR write path MUST go through this
 * helper. Caller cannot forget the model version (compile error +
 * runtime fail-CLOSED).
 *
 * Throws `WHISPER_MODEL_VERSION_MISSING` if `modelVersion` is empty or
 * does not match WHISPER_MODEL_VERSION_PATTERN. The throw is the L1
 * runtime layer beneath the L0 type-system enforcement (`modelVersion`
 * is non-optional on the args type).
 */
export async function recordWhisperAsrInteraction(
  args: RecordWhisperAsrInteractionArgs,
): Promise<string> {
  if (!args.modelVersion || !WHISPER_MODEL_VERSION_PATTERN.test(args.modelVersion)) {
    throw new Error(
      `WHISPER_MODEL_VERSION_MISSING: recordWhisperAsrInteraction requires modelVersion matching ${WHISPER_MODEL_VERSION_PATTERN}. ` +
        `Got: ${JSON.stringify(args.modelVersion)}. ` +
        `Use getWhisperModelVersion() to resolve before calling. CLAUDE.md §6.3 + Audit Tier 4.4 require version capture on every ASR audit row.`,
    );
  }

  const durationApproxTokens = args.durationSeconds
    ? Math.ceil(args.durationSeconds * 25)
    : undefined;

  return recordLlmInteraction({
    clinicId: args.clinicId,
    userId: args.userId,
    patientId: args.patientId ?? null,
    episodeId: args.episodeId ?? null,
    feature: 'ambient.asr',
    modelName: args.modelName,
    modelVersion: args.modelVersion,
    modelProvider: 'whisper',
    pipeline: args.pipeline,
    completionTokens: durationApproxTokens,
    totalTokens: durationApproxTokens,
    latencyMs: args.latencyMs,
    success: args.success ?? true,
    errorCode: args.errorCode,
    metadata: args.metadata,
  });
}

/**
 * Extract the canonical Whisper model + version from an /inference
 * response payload. SSoT — used by ambientProcessor and any future
 * direct-/inference caller.
 *
 * Falls back to `getWhisperModelVersion()` (the cached /health probe)
 * when the /inference response did not carry a well-formed
 * `model_version` field — older Whisper server builds, or an upgrade
 * race where the loader hasn't yet computed the digest.
 */
export async function parseWhisperVersionFromResponse(
  data: { model?: unknown; model_version?: unknown },
): Promise<{ whisperModel: string; whisperModelVersion: string }> {
  const whisperModel = typeof data.model === 'string' ? data.model : WHISPER_MODEL_NAME_DEFAULT;
  const whisperModelVersion =
    typeof data.model_version === 'string' && WHISPER_MODEL_VERSION_PATTERN.test(data.model_version)
      ? data.model_version
      : await getWhisperModelVersion();
  return { whisperModel, whisperModelVersion };
}

/**
 * Audit-with-fallback wrapper for ambient pipelines: writes the
 * `feature='ambient.asr'` row alongside an Ollama `feature='ambient'`
 * row, but does NOT throw on audit failure — clinical flow continues,
 * the failure is logged with full forensic context so an operator
 * dashboard can find the affected recording.
 *
 * Caller invariant: this is invoked AFTER the Ollama row already
 * landed, so degrading the ASR row (rather than aborting the whole
 * pipeline) preserves the clinical artefact + degrades only the
 * forensic identity for THIS recording.
 */
export async function recordWhisperAsrInteractionSafely(
  args: RecordWhisperAsrInteractionArgs,
): Promise<void> {
  try {
    await recordWhisperAsrInteraction(args);
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        whisperModelTag: args.modelName,
        whisperModelVersion: args.modelVersion,
        clinicId: args.clinicId,
      },
      '[BUG-424] Whisper ASR audit row failed — clinical flow preserved, forensic identity for THIS recording is degraded',
    );
  }
}
