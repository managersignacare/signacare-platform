#!/usr/bin/env tsx
/**
 * Guard the regulatory boundary between the non-inferential core scribe and
 * optional inference-inclusive agentic scribe surfaces.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const CORE_SCRIBE_PREFIX = 'apps/api/src/mcp/';
const AGENTIC_BACKEND_PREFIXES = [
  'apps/api/src/features/llm/agenticScribe',
  'apps/api/src/features/scribe-agentic/',
];

const violations: string[] = [];

function trackedFiles(): string[] {
  return execSync('git ls-files -z', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\0')
    .filter(Boolean);
}

function read(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function isTsSource(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mts|cts)$/.test(filePath);
}

function importSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) specs.add(match[1]);
    }
  }
  return [...specs];
}

function isAgenticBackend(filePath: string): boolean {
  return AGENTIC_BACKEND_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

for (const file of trackedFiles()) {
  if (!isTsSource(file) || !existsSync(file)) continue;
  const source = read(file);
  const specs = importSpecifiers(source);

  if (file.startsWith(CORE_SCRIBE_PREFIX)) {
    for (const spec of specs) {
      if (/agenticScribe|scribe-agentic/i.test(spec)) {
        violations.push(`${file}: core scribe must not import optional agentic module "${spec}"`);
      }
    }
  }

  if (isAgenticBackend(file)) {
    for (const spec of specs) {
      if (/\/mcp(?:\/|$)|\.\.\/\.\.\/mcp|\.\.\/mcp/.test(spec)) {
        violations.push(`${file}: agentic scribe route/module must not import core mcp module "${spec}"`);
      }
    }
  }
}

const routePath = 'apps/api/src/features/llm/agenticScribeRoutes.ts';
if (!existsSync(routePath)) {
  violations.push(`${routePath}: required agentic scribe route is missing`);
} else {
  const route = read(routePath);
  const requiredPatterns: Array<[RegExp | string, string]> = [
    ['MODULE_KEYS.AGENTIC_AI_SCRIBE', 'agentic route must be gated by the optional agentic AI scribe module'],
    ['missingRowPolicy: \'disabled\'', 'agentic route must fail closed when the clinic module row is missing'],
    ['requireModuleRead(MODULE_KEYS.AGENTIC_AI_SCRIBE)', 'agentic read surface must be module-read gated'],
    ['requireModuleWrite(MODULE_KEYS.AGENTIC_AI_SCRIBE)', 'agentic task creation must be module-write gated'],
    ['CLINICAL_AI_DISCLAIMER', 'agentic generated drafts must carry the canonical clinical AI disclaimer'],
    ['writeAuditLog', 'agentic clinician decisions must remain audit logged'],
    ['../../shared/scribeActionExtractor', 'agentic action extraction must use the neutral shared extractor, not core mcp modules'],
  ];
  for (const [pattern, reason] of requiredPatterns) {
    const found = typeof pattern === 'string' ? route.includes(pattern) : pattern.test(route);
    if (!found) violations.push(`${routePath}: ${reason}`);
  }
}

if (violations.length > 0) {
  console.error('Scribe agentic isolation guard failed:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Scribe agentic isolation guard passed.');
