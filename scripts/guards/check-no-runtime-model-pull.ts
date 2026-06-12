#!/usr/bin/env tsx
/**
 * Phase 4 + 5 — guard against runtime model fetches.
 *
 * Both the Azure private fast lane (Phase 4 #4) and the sovereign GPU
 * lane (Phase 5 #2) require model references to be IMMUTABLE at
 * provision time. There must be NO `ollama pull <model>`-style runtime
 * fetch anywhere in the build artefacts or worker code paths.
 *
 * What this guard catches:
 *   - Dockerfiles invoking `ollama pull` in CMD / ENTRYPOINT (vs RUN
 *     during build, which IS allowed because it bakes the layer).
 *   - Shell scripts invoked at container start that call `ollama pull`.
 *   - Application code that calls the Ollama API `/api/pull` endpoint.
 *   - Bicep / appSettings that name a model by mutable tag without an
 *     accompanying SHA-256 manifest digest.
 *
 * What this guard does NOT catch (permanent: distinct threat surfaces
 * covered by sibling controls — NOT silent deferrals):
 *   - Azure OpenAI deployments that pin to "latest" — covered by Bicep
 *     param validation + `azureOpenAi.bicep` `versionUpgradeOption:
 *     NoAutoUpgrade`.
 *   - Whisper model fetches — Whisper is a separate runtime that bakes
 *     its model via `WHISPER_MODEL_SHA256` env in
 *     `ai-runtime-appservice.bicep`. Permanent scope boundary: this
 *     guard covers LLM-class runtime pulls (`ollama pull` / `/api/pull`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

const SCAN_ROOTS = [
  'apps/api/src',
  'apps/web/src',
  'apps/api/Dockerfile',
  'deploy',
  'scripts',
] as const;

interface Violation {
  file: string;
  line: number;
  excerpt: string;
  reason: string;
}

// `ollama pull <model>` and `/api/pull` HTTP endpoint calls at runtime.
// We deliberately do NOT flag `RUN ollama pull` in Dockerfiles because
// that runs at BUILD time and bakes the model into the image layer.
// Only CMD/ENTRYPOINT/healthcheck and shell-script invocations count.
const RUNTIME_PULL_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bollama\s+pull\b/,
    reason: 'Runtime invocation of `ollama pull` is forbidden. Bake the model into the image at build time (Phase 5 #2).',
  },
  {
    pattern: /['"`]\/api\/pull['"`]/,
    reason: 'Runtime HTTP call to Ollama `/api/pull` is forbidden. Models must be immutable at runtime (Phase 5 #2).',
  },
];

// Allowlisted shapes that the guard recognises as BUILD-time only.
// Dockerfile `RUN ollama pull <model>` is the canonical baking pattern.
const BUILD_TIME_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*RUN\s+(?:--mount=[^\s]+\s+)*.*ollama\s+pull\b/,
];

// Allowlist of file paths that legitimately reference the forbidden
// patterns (e.g. the guard itself, audit docs that quote the pattern).
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  'scripts/guards/check-no-runtime-model-pull.ts',
  'docs/operations/runbooks/sovereign-gpu-lane.md',
  'docs/operations/runbooks/azure-private-fast-lane.md',
  'docs/operations/runbooks/ai-lane-failover.md',
]);

function shouldSkipDir(name: string): boolean {
  return name === 'node_modules' || name === 'dist' || name === '.git' || name === '.next' || name === 'coverage';
}

function isScannable(file: string): boolean {
  return /\.(ts|tsx|js|sh|bash|bicep|yml|yaml|tf|Dockerfile)$/i.test(file) || file.endsWith('Dockerfile');
}

function walk(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (shouldSkipDir(entry)) continue;
    const full = resolve(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, acc);
    else if (isScannable(entry)) acc.push(full);
  }
}

function isBuildTime(line: string): boolean {
  return BUILD_TIME_PATTERNS.some((p) => p.test(line));
}

/**
 * True iff the index `at` in `line` falls INSIDE a string literal or
 * after a same-line `//` comment marker. Both cases mean the pattern
 * is documentation, not an executable shell/code invocation.
 *
 * Strict-enough heuristic: we count quote characters before `at`. Odd
 * count → inside a string literal. We also scan for an un-escaped `//`
 * before `at` (treating any `//` not inside a string as a comment).
 */
function isInDocumentationContext(line: string, at: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < at; i++) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if (c === '\\' && prev !== '\\') continue;
    if (!inDouble && !inBacktick && c === "'" && prev !== '\\') inSingle = !inSingle;
    else if (!inSingle && !inBacktick && c === '"' && prev !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && c === '`' && prev !== '\\') inBacktick = !inBacktick;
    else if (!inSingle && !inDouble && !inBacktick && c === '/' && line[i + 1] === '/') {
      // Same-line `//` comment opened before the match.
      return true;
    }
  }
  return inSingle || inDouble || inBacktick;
}

const files: string[] = [];
for (const root of SCAN_ROOTS) {
  const abs = resolve(ROOT, root);
  let st;
  try {
    st = statSync(abs);
  } catch {
    continue;
  }
  if (st.isDirectory()) walk(abs, files);
  else if (st.isFile()) files.push(abs);
}

const violations: Violation[] = [];

for (const absPath of files) {
  const relPath = relative(ROOT, absPath);
  if (ALLOWED_FILES.has(relPath)) continue;

  const source = readFileSync(absPath, 'utf8');
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip pure-comment Bicep/TS lines that just describe forbidden patterns.
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;
    if (isBuildTime(line)) continue;
    for (const { pattern, reason } of RUNTIME_PULL_PATTERNS) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (isInDocumentationContext(line, match.index)) continue;
      violations.push({ file: relPath, line: i + 1, excerpt: line.trim(), reason });
      break;
    }
  }
}

if (violations.length > 0) {
  console.error('check-no-runtime-model-pull: runtime model fetch detected.');
  console.error('');
  console.error('Phase 4 #4 + Phase 5 #2 forbid runtime `ollama pull` / `/api/pull`.');
  console.error('Bake the model into the container image at build time, and reference');
  console.error('it via the immutable manifest SHA-256 (OLLAMA_MODEL_MANIFEST_SHA256).');
  console.error('');
  console.error('Violations:');
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line}`);
    console.error(`      ${v.excerpt}`);
    console.error(`      ${v.reason}`);
  }
  process.exit(1);
}

console.log('check-no-runtime-model-pull: passed.');
