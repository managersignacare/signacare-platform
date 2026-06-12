/**
 * Phase 7 — ASR (Whisper) backend selection contract.
 *
 * The benchmark harness + clinical runtime resolve the active ASR
 * backend through this enum. The runtime resolution falls back to the
 * stable default (`whisper/cpu` — the existing CPU Whisper server)
 * when the env var is unset OR when the requested backend's required
 * configuration is incomplete; the fallback is LOUD (logger.warn +
 * metric) per CLAUDE.md fail-silent-default policy (M5).
 *
 * Adding a new backend is a two-step contract change:
 *   1. Add the enum literal here.
 *   2. Wire the resolver in apps/api/src/mcp/whisperBackend.ts +
 *      record the new env vars in the benchmark README.
 *
 * Phase 7 does NOT change the default behaviour — the existing
 * `whisper/cpu` Flask server at `WHISPER_API_URL` continues to serve
 * every clinical request. The flag is opt-in: setting
 * `SIGNACARE_WHISPER_BACKEND=faster-whisper` requires also setting
 * `FASTER_WHISPER_API_URL` to a reachable endpoint (the resolver
 * fails closed otherwise).
 */
import { z } from 'zod';

/**
 * Closed list of ASR backends recognised by the runtime + benchmark.
 *
 *   - `whisper/cpu`     — current production. Flask Whisper server at
 *                         WHISPER_API_URL. The default if the env flag
 *                         is unset OR a non-default selection fails to
 *                         resolve required config.
 *   - `faster-whisper`  — drop-in compatible HTTP endpoint that runs
 *                         CTranslate2-backed Whisper for higher
 *                         throughput. Same `/inference` contract as
 *                         `whisper/cpu`; flag-gated for canary.
 *   - `gpu-managed`     — Azure-managed transcription (or equivalent
 *                         GPU-hosted provider). Distinct endpoint +
 *                         API-key contract; intended for the Phase 4
 *                         azure_fast lane.
 */
export const WhisperBackendSchema = z.enum(['whisper/cpu', 'faster-whisper', 'gpu-managed']);
export type WhisperBackend = z.infer<typeof WhisperBackendSchema>;

/** Default backend when SIGNACARE_WHISPER_BACKEND is unset. */
export const DEFAULT_WHISPER_BACKEND: WhisperBackend = 'whisper/cpu';

/** Env-var name read by the runtime + benchmark to select a backend. */
export const WHISPER_BACKEND_ENV_VAR = 'SIGNACARE_WHISPER_BACKEND';

/**
 * Coerce an arbitrary env-var value into a recognised backend OR the
 * `null` sentinel meaning "unrecognised / unset". A `null` from this
 * function instructs the resolver to use {@link DEFAULT_WHISPER_BACKEND}
 * AND emit a loud warning if the original input was non-empty (so a
 * typo in the env var doesn't silently regress the runtime).
 */
export function parseWhisperBackendEnv(raw: string | undefined): WhisperBackend | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = WhisperBackendSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}
