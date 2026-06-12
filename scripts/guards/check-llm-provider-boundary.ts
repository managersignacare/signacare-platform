#!/usr/bin/env tsx
/**
 * Guard the LLM provider boundary.
 *
 * Clinical/application surfaces should route through modelRouter instead of
 * importing low-level provider adapters directly. This keeps backend locking,
 * audit metadata, and fallback rules centralized.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

type Rule = {
  readonly token: string;
  readonly allowedFiles: readonly string[];
  readonly reason: string;
};

const RULES: readonly Rule[] = [
  {
    token: 'callAzureOpenAiChat',
    allowedFiles: [
      'apps/api/src/features/llm/modelRouter/modelRouter.ts',
      'apps/api/src/features/llm/modelRouter/azureOpenAiAdapter.ts',
    ],
    reason: 'Azure chat adapter must only be referenced by the router and its own adapter module',
  },
  {
    token: 'callLocalLlm',
    allowedFiles: [
      'apps/api/src/features/llm/modelRouter/modelRouter.ts',
      'apps/api/src/mcp/localLlmAgent.ts',
    ],
    reason: 'local Ollama text generation must only be referenced by the router and the local adapter itself',
  },
  {
    token: 'generateOllamaText',
    allowedFiles: [
      'apps/api/src/mcp/localLlmAgent.ts',
      'apps/api/src/shared/ollamaHttpClient.ts',
    ],
    reason: 'low-level Ollama generate calls must stay centralized in the shared HTTP adapter',
  },
  {
    token: 'listOllamaTags',
    allowedFiles: [
      'apps/api/src/mcp/localLlmAgent.ts',
      'apps/api/src/features/llm/llmTrainingRoutes.ts',
      'apps/api/src/shared/ollamaHttpClient.ts',
    ],
    reason: 'Ollama model-tag lookups must stay centralized in the shared HTTP adapter',
  },
];

function trackedFiles(): string[] {
  return execSync('git ls-files -z', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0')
    .filter(Boolean);
}

function read(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function isSourceFile(filePath: string): boolean {
  return filePath.startsWith('apps/api/src/') && /\.(ts|tsx|mts|cts)$/.test(filePath);
}

function hasTokenUsage(source: string, token: string): boolean {
  const patterns = [
    new RegExp(`\\b${token}\\b`),
  ];
  return patterns.some((pattern) => pattern.test(source));
}

const violations: string[] = [];

for (const file of trackedFiles()) {
  if (!isSourceFile(file) || !existsSync(file)) continue;
  const source = read(file);

  for (const rule of RULES) {
    if (!hasTokenUsage(source, rule.token)) continue;
    if (rule.allowedFiles.includes(file)) continue;
    violations.push(`${file}: ${rule.reason} (found token ${rule.token})`);
  }
}

if (violations.length > 0) {
  console.error('LLM provider boundary guard failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('LLM provider boundary guard passed.');
