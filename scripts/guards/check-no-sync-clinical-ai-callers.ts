#!/usr/bin/env tsx
/**
 * Phase 3 async-routing hardening — CI guard.
 *
 * Fails the build if any apps/web/src caller POSTs to the synchronous
 * `/llm/clinical-ai` endpoint or legacy `/llm/generate` endpoint for
 * clinical AI work that must now flow through durable jobs.
 *
 * Defence in depth: the runtime guard `assertSyncClinicalAiRouteAllowed`
 * (apps/api/src/features/llm/asyncClinicalAiGuard.ts) already returns
 * 409 if a long action sneaks through; this guard catches the same
 * regression at build time, before it ships, so contributors see the
 * failure during pre-commit / CI rather than at runtime.
 *
 * Scope:
 *   - Only flags `apps/web/src/**\/*.{ts,tsx}` (non-test) files.
 *   - Greps for literal sync endpoint call shapes, including leading-slash
 *     variants, `apiClient.request(...)`, and direct `fetch(...)`.
 *   - For each match, requires the file to be on the ALLOWED_FILES
 *     allowlist OR there are zero matches anywhere.
 *
 * ALLOWED_FILES allowlist rationale (each entry is structurally justified
 * inline below):
 *   - AiAgentPage.tsx — the free-form AI assistant. Has runtime
 *     branching `isDurableClinicalAiJobAction + requiresAsyncClinicalAiJob`
 *     that routes long actions to `llmAiJobsApi.runClinicalAiJobDetailed`
 *     BEFORE falling through to the sync POST. Verified by
 *     `apps/web/src/shared/services/llmAiJobsApi.test.ts`.
 *   - ClinicalAiJobsDashboard.tsx — comment-only reference to the
 *     deprecated sync path in user-facing copy.
 *   - apiClient.ts — apiClient interceptor wiring that recognises the
 *     URL for timeout / conversationId injection; no POST is issued
 *     from this file.
 *
 * Adding a new file to ALLOWED_FILES is an architectural change that
 * requires operator sign-off + inline rationale on the allowlist row.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const WEB_SRC = resolve(ROOT, 'apps/web/src');

const ALLOWED_FILES: ReadonlySet<string> = new Set([
  'apps/web/src/features/ai-agent/pages/AiAgentPage.tsx',
  'apps/web/src/features/patients/components/detail/tabs/ClinicalAiJobsDashboard.tsx',
  'apps/web/src/shared/services/apiClient.ts',
]);

// The literal alone (e.g. in a docstring comment) is harmless; we only flag
// actual call/request sites for stale browser-held clinical AI paths.
const SYNC_ENDPOINT = String.raw`\/?(?:api\/v1\/)?llm\/(?:clinical-ai|generate)`;
const SYNC_CALL_SHAPES = [
  new RegExp(String.raw`apiClient\s*\.\s*post\s*(?:<[^>]+>)?\s*\(\s*['"\`]${SYNC_ENDPOINT}['"\`]`),
  new RegExp(String.raw`apiClient\s*\.\s*request\s*(?:<[^>]+>)?\s*\(\s*['"\`]${SYNC_ENDPOINT}['"\`]`),
  new RegExp(String.raw`apiClient\s*\.\s*request\s*(?:<[^>]+>)?\s*\(\s*\{[\s\S]{0,240}\burl\s*:\s*['"\`]${SYNC_ENDPOINT}['"\`]`),
  new RegExp(String.raw`\bfetch\s*\(\s*['"\`]${SYNC_ENDPOINT}['"\`]`),
];

function walk(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
}

const files: string[] = [];
walk(WEB_SRC, files);

const violations: string[] = [];

for (const absPath of files) {
  const source = readFileSync(absPath, 'utf8');
  if (!SYNC_CALL_SHAPES.some((shape) => shape.test(source))) continue;
  const relPath = relative(ROOT, absPath);
  if (ALLOWED_FILES.has(relPath)) continue;
  violations.push(relPath);
}

if (violations.length > 0) {
  console.error('check-no-sync-clinical-ai-callers: stale sync clinical AI caller detected.');
  console.error('');
  console.error('Phase 3 hardening requires every long clinical action to flow through');
  console.error("llmAiJobsApi.runClinicalAiJob / queueClinicalAiJob (durable async path).");
  console.error('');
  console.error('Offending file(s):');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('');
  console.error('Fix one of:');
  console.error("  (a) Replace the apiClient.post('llm/clinical-ai'|'llm/generate', { ... }) with");
  console.error('      `await llmAiJobsApi.runClinicalAiJob({ action, data, patientId })`.');
  console.error('  (b) If this caller is a legitimate bounded-utility surface (not in the');
  console.error('      DURABLE closed list), add the file path to ALLOWED_FILES in');
  console.error("      scripts/guards/check-no-sync-clinical-ai-callers.ts with an inline");
  console.error("      structural rationale. Requires operator sign-off.");
  process.exit(1);
}

console.log('check-no-sync-clinical-ai-callers: passed.');
