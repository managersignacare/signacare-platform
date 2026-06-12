/**
 * Phase 7 — ASR backend resolver.
 *
 * Reads the `SIGNACARE_WHISPER_BACKEND` env var and resolves the active
 * Whisper backend at runtime. The resolution is fail-LOUD on every
 * fallback path:
 *
 *   - Unrecognised env value → DEFAULT_WHISPER_BACKEND + logger.warn.
 *   - Recognised non-default backend whose required config is missing
 *     → DEFAULT_WHISPER_BACKEND + logger.warn.
 *
 * Phase 7 does NOT mutate the existing Whisper call sites. Callers
 * that want backend-aware routing consume `resolveWhisperBackend()`
 * and pick the corresponding endpoint URL via
 * `resolveWhisperEndpoint()`. Direct readers of `WHISPER_API_URL`
 * remain on the default lane unless they are migrated to the resolver
 * in a follow-up slice.
 */
import { logger } from '../utils/logger';
import {
  DEFAULT_WHISPER_BACKEND,
  WHISPER_BACKEND_ENV_VAR,
  WhisperBackendSchema,
  parseWhisperBackendEnv,
  type WhisperBackend,
} from '@signacare/shared';

export interface WhisperBackendResolution {
  /** Backend the runtime will route to. */
  backend: WhisperBackend;
  /** Backend the env var requested (null if unset / blank). */
  requested: WhisperBackend | null;
  /** Raw env value, untrimmed (for diagnostics). */
  rawEnv: string | undefined;
  /**
   * `true` iff the resolver chose the default after rejecting the
   * requested backend. Visible to callers + telemetry.
   */
  fellBackToDefault: boolean;
  /**
   * Human-readable fallback reason (when fellBackToDefault === true).
   * Used by audit telemetry + the benchmark harness output.
   */
  fallbackReason: string | null;
}

/**
 * Endpoint URL for the resolved backend. The benchmark harness + any
 * future routing-aware caller uses this to obtain the HTTP base URL.
 *
 *   - `whisper/cpu`    → WHISPER_API_URL (default Flask server)
 *   - `faster-whisper` → FASTER_WHISPER_API_URL
 *   - `gpu-managed`    → GPU_MANAGED_ASR_API_URL
 *
 * Returns `null` when the backend's URL env var is unset; the resolver
 * consumes this signal to fall back loudly to the default.
 */
export function whisperEndpointUrlFor(
  backend: WhisperBackend,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  switch (backend) {
    case 'whisper/cpu':
      return env.WHISPER_API_URL ?? 'http://localhost:8080';
    case 'faster-whisper':
      return env.FASTER_WHISPER_API_URL ?? null;
    case 'gpu-managed':
      return env.GPU_MANAGED_ASR_API_URL ?? null;
  }
}

/**
 * Resolve the active ASR backend. Pure (no I/O); takes the env map +
 * optional logger override for tests. Default arg uses process.env +
 * the production logger.
 *
 * Production callers + the benchmark harness use the zero-arg form.
 */
export function resolveWhisperBackend(env: NodeJS.ProcessEnv = process.env): WhisperBackendResolution {
  const rawEnv = env[WHISPER_BACKEND_ENV_VAR];
  const requested = parseWhisperBackendEnv(rawEnv);

  // Unset OR unrecognised → default.
  if (!requested) {
    const fallbackReason =
      rawEnv && rawEnv.trim() ? `unrecognised value "${rawEnv}" (allowed: ${WhisperBackendSchema.options.join(', ')})` : null;
    if (fallbackReason) {
      logger.warn(
        { rawEnv, allowed: WhisperBackendSchema.options },
        '[whisperBackend] unrecognised SIGNACARE_WHISPER_BACKEND value — falling back to default',
      );
    }
    return {
      backend: DEFAULT_WHISPER_BACKEND,
      requested: null,
      rawEnv,
      fellBackToDefault: Boolean(fallbackReason),
      fallbackReason,
    };
  }

  // Recognised default-equivalent → no fallback signal needed.
  if (requested === DEFAULT_WHISPER_BACKEND) {
    return {
      backend: DEFAULT_WHISPER_BACKEND,
      requested,
      rawEnv,
      fellBackToDefault: false,
      fallbackReason: null,
    };
  }

  // Recognised non-default → confirm endpoint URL is reachable in
  // config. If the URL env var is unset, fall back to default and emit
  // a structured warning so the operator can fix the deployment.
  const url = whisperEndpointUrlFor(requested, env);
  if (!url) {
    const fallbackReason = `backend "${requested}" requested but its endpoint URL env var is unset`;
    logger.warn(
      { rawEnv, requested, fallbackReason },
      '[whisperBackend] non-default backend selected but endpoint URL unset — falling back to default lane',
    );
    return {
      backend: DEFAULT_WHISPER_BACKEND,
      requested,
      rawEnv,
      fellBackToDefault: true,
      fallbackReason,
    };
  }

  return {
    backend: requested,
    requested,
    rawEnv,
    fellBackToDefault: false,
    fallbackReason: null,
  };
}

/**
 * Convenience: return both the active backend and its endpoint URL.
 * Throws if the resolver's reported backend has no URL (the only
 * defensible state for which this should ever happen is a bug in the
 * resolver itself; we fail loud rather than silently mis-route).
 */
export function resolveWhisperEndpoint(env: NodeJS.ProcessEnv = process.env): {
  backend: WhisperBackend;
  url: string;
  resolution: WhisperBackendResolution;
} {
  const resolution = resolveWhisperBackend(env);
  const url = whisperEndpointUrlFor(resolution.backend, env);
  if (!url) {
    throw new Error(
      `[whisperBackend] resolver returned backend "${resolution.backend}" with no endpoint URL — this is a resolver bug, not a config issue`,
    );
  }
  return { backend: resolution.backend, url, resolution };
}
