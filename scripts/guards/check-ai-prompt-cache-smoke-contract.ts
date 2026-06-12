#!/usr/bin/env tsx
/**
 * Phase 6 prompt-cache smoke contract.
 *
 * Azure prompt caching only helps if deployment smoke proves the active
 * runtime exposes a stable prompt-prefix hash and cached_tokens telemetry
 * capability. This guard pins that proof in the canonical Azure workflow.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

function read(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const checks: Array<{ path: string; patterns: Array<[RegExp | string, string]> }> = [
  {
    path: 'deploy/azure/post-deploy-smoke.sh',
    patterns: [
      ['ai_capabilities_smoke_required', 'smoke script must decide when AI capabilities proof is mandatory'],
      ['prompt_cache_telemetry_required', 'smoke script must support mandatory cached_tokens telemetry assertion'],
      ['/api/v1/ai/capabilities', 'smoke script must call the AI capabilities endpoint'],
      ['promptPrefixHashSample', 'smoke script must validate stable prompt-prefix hash proof'],
      ['cachedTokensTelemetryEnabled', 'smoke script must validate cached_tokens telemetry flag'],
      ['SMOKE_EXPECT_AI_LANE', 'smoke script must support lane-specific assertions'],
      ['activeLane.health', 'smoke script must reject disabled/unhealthy active lanes'],
    ],
  },
  {
    path: '.github/workflows/azure-deploy.yml',
    patterns: [
      ['SMOKE_REQUIRE_AI_CAPABILITIES', 'Azure workflow must enable AI capabilities smoke in deploy env'],
      ['SMOKE_REQUIRE_PROMPT_CACHE_TELEMETRY', 'Azure workflow must expose prompt-cache telemetry requirement'],
      ['SMOKE_EXPECT_AI_LANE', 'Azure workflow must expose expected AI lane assertion'],
      [/SMOKE_REQUIRE_PROMPT_CACHE_TELEMETRY:\s*\$\{\{ vars\.SMOKE_REQUIRE_PROMPT_CACHE_TELEMETRY \}\}/, 'Azure workflow must not force prompt-cache telemetry to false by default'],
      [/Post-swap smoke test[\s\S]*SMOKE_REQUIRE_AI_CAPABILITIES:\s*'true'/, 'post-swap prod smoke must require AI capabilities proof'],
    ],
  },
  {
    path: 'apps/api/src/features/llm/aiCapabilities.ts',
    patterns: [
      ['promptPrefixHashSample: buildPromptPrefixHashSample()', 'capabilities response must expose stable prompt-prefix hash sample'],
      ['cachedTokensTelemetryEnabled: true', 'Azure lane must advertise cached_tokens telemetry support'],
    ],
  },
];

const violations: string[] = [];

for (const check of checks) {
  let source = '';
  try {
    source = read(check.path);
  } catch (err) {
    violations.push(`${check.path}: missing (${(err as Error).message})`);
    continue;
  }

  for (const [pattern, reason] of check.patterns) {
    const ok = typeof pattern === 'string' ? source.includes(pattern) : pattern.test(source);
    if (!ok) violations.push(`${check.path}: ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('AI prompt-cache smoke contract failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('AI prompt-cache smoke contract passed.');
