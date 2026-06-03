/**
 * Resolve absolute paths for external binaries we shell out to.
 *
 * Four call sites rely on this today — backupRoutes (pg_dump, gzip,
 * gunzip), llmTrainingRoutes (ollama), ocrAdapter (ocrmypdf,
 * pdftotext, tesseract), and bootstrap (python3 via WHISPER_PYTHON).
 * All four were previously calling binaries by relative name and
 * inheriting the child process PATH — which on macOS dev boxes with
 * multiple homebrew / python.org / system installs frequently picked
 * the wrong binary and produced confusing ModuleNotFoundError or
 * "command not found" failures.
 *
 * Resolution order per binary:
 *
 *   1. Explicit env override — `${BINARY}_PATH` uppercased. Always
 *      wins. Lets operators pin a specific interpreter in .env
 *      without touching code.
 *   2. A small list of well-known absolute paths in order —
 *      /opt/homebrew first on Apple Silicon, /usr/local next for
 *      Intel + python.org installs, /usr/bin last for system.
 *   3. Fall-through to the plain binary name so the child process
 *      PATH can still find it — matches prior behaviour in Linux
 *      containers and the prod Docker image where the defaults are
 *      already correct.
 *
 * This module does NOT swallow "binary missing" — the caller spawns
 * the resolved path and surfaces the ENOENT if the binary genuinely
 * isn't present. We just shortcut the PATH lookup.
 *
 * Naming convention: `${BINARY}_PATH` env var in UPPERCASE_SNAKE
 * (e.g. `PG_DUMP_PATH`, `OLLAMA_PATH`). One exception: Whisper's
 * python interpreter uses `WHISPER_PYTHON` for historical continuity
 * with the bootstrap.ts env var the dev `.env` already sets.
 */
import fs from 'fs';

const CANDIDATE_DIRS = [
  '/opt/homebrew/bin',       // Apple Silicon brew
  '/opt/homebrew/sbin',
  '/usr/local/bin',          // Intel brew + python.org
  '/usr/local/sbin',
  '/usr/bin',                // system
  '/bin',
] as const;

const cache = new Map<string, string>();

export function resolveBinary(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  // 1. Env override
  const envKey = `${name.toUpperCase().replace(/-/g, '_')}_PATH`;
  const envVal = process.env[envKey];
  if (envVal && envVal.trim().length > 0) {
    cache.set(name, envVal);
    return envVal;
  }

  // 2. Well-known absolute paths
  for (const dir of CANDIDATE_DIRS) {
    const candidate = `${dir}/${name}`;
    try {
      if (fs.existsSync(candidate)) {
        cache.set(name, candidate);
        return candidate;
      }
    } catch { /* stat may throw on permissioned dirs — ignore */ }
  }

  // 3. Fall through to PATH
  cache.set(name, name);
  return name;
}

/** Convenience — clears the resolution cache. Used in tests only. */
export function __resetBinaryResolverForTests(): void {
  cache.clear();
}
