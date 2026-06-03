#!/usr/bin/env tsx
/**
 * BUG-312 — non-pino error/warn paths bypass BUG-267 err serializer.
 *
 * Guard contract:
 * - Runtime application code must not use `console.error(...)` or
 *   `console.warn(...)` directly, except a small set of boot-time /
 *   emergency channels where pino may not be initialized yet.
 * - Seed/demo/dev utility scripts are out of scope.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const API_SRC = resolve(REPO_ROOT, 'apps', 'api', 'src');

const CONSOLE_ERROR_WARN_RE = /\bconsole\.(error|warn)\s*\(/;

const BOOTSTRAP_ALLOWLIST = new Set<string>([
  // Early-process fatal handlers and fallback flush diagnostics.
  'apps/api/src/server.ts',
  // Pre-server boot boundary; stderr-only diagnostics if boot fails.
  'apps/api/src/index.ts',
  // Zod env validation / startup warnings before app logger context.
  'apps/api/src/config/config.ts',
  // Secrets resolver runs before normal logger wiring.
  'apps/api/src/config/secrets.ts',
  // OTel initialization executes before logger import ordering.
  'apps/api/src/observability/otel.ts',
  // Third-party BullMQ warning-policy interception.
  'apps/api/src/shared/installBullmqEvictionWarningPolicy.ts',
  // Logger fallback writes.
  'apps/api/src/utils/logger.ts',
]);

const SCRIPT_ALLOWLIST_BASENAMES = new Set<string>([
  'cluster.ts',
  'reset-patient-data.ts',
  'erx001-sample-for-xsd.ts',
]);

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'migrations' || entry.name === 'db' && full.endsWith(`${sep}migrations`)) {
        continue;
      }
      walkTsFiles(full).forEach((f) => out.push(f));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    out.push(full);
  }
  return out;
}

function isOutOfScope(relPath: string): boolean {
  if (relPath.includes('/migrations/')) return true;
  if (relPath.includes('/seed-good-health/')) return true;
  if (relPath.includes('/tests/')) return true;
  if (relPath.includes('/__tests__/')) return true;
  if (relPath.includes('/seed-')) return true;
  const base = relPath.split('/').pop() ?? '';
  if (base.startsWith('seed-')) return true;
  if (SCRIPT_ALLOWLIST_BASENAMES.has(base)) return true;
  return false;
}

function main(): number {
  const files = walkTsFiles(API_SRC);
  const violations: Array<{ file: string; line: number; snippet: string }> = [];

  for (const file of files) {
    const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
    if (isOutOfScope(rel)) continue;
    if (BOOTSTRAP_ALLOWLIST.has(rel)) continue;

    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx] ?? '';
      if (!CONSOLE_ERROR_WARN_RE.test(line)) continue;
      violations.push({
        file: rel,
        line: idx + 1,
        snippet: line.trim(),
      });
    }
  }

  if (violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error('check-non-pino-error-paths: FAIL');
    // eslint-disable-next-line no-console
    console.error('  Runtime console.error/console.warn detected outside BUG-312 allowlist:');
    for (const violation of violations) {
      // eslint-disable-next-line no-console
      console.error(`  - ${violation.file}:${violation.line}`);
      // eslint-disable-next-line no-console
      console.error(`    ${violation.snippet}`);
    }
    // eslint-disable-next-line no-console
    console.error('  Fix: route through utils/logger (pino serializer) or document a bootstrap-only allowlist entry.');
    return 1;
  }

  // eslint-disable-next-line no-console
  console.error('check-non-pino-error-paths: PASS (no runtime console.error/console.warn outside allowlist)');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
