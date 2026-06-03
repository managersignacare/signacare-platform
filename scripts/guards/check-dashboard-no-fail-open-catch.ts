#!/usr/bin/env tsx
/**
 * M5 dashboard hardening guard:
 * prevent local `.catch(...)` fail-open fallbacks on dashboard query surfaces.
 *
 * Why:
 * - Local catch-fallbacks (`.catch(() => ({data: []}))`) can hide API
 *   outages and render false-zero KPI cards.
 * - Dashboard should expose query error state via React Query `isError`
 *   instead of silently coercing to empty payloads.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const TARGETS = [
  'apps/web/src/features/dashboard/pages/DashboardPage.tsx',
  'apps/web/src/features/dashboard/pages/DashboardViewBits.tsx',
];

const CATCH_RE = /\.catch\s*\(/g;

export interface Violation {
  file: string;
  line: number;
}

export function runGuard(opts?: { repoRoot?: string; targets?: string[] }): {
  scannedFiles: number;
  violations: Violation[];
} {
  const root = opts?.repoRoot ?? REPO_ROOT;
  const targets = opts?.targets ?? TARGETS;
  const violations: Violation[] = [];

  for (const rel of targets) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (CATCH_RE.test(line)) {
        violations.push({ file: rel, line: i + 1 });
      }
      CATCH_RE.lastIndex = 0;
    }
  }

  return {
    scannedFiles: targets.length,
    violations,
  };
}

function main(): number {
  const result = runGuard();
  console.error('→ check-dashboard-no-fail-open-catch');
  console.error(`  files scanned: ${result.scannedFiles}`);
  console.error(`  violations:   ${result.violations.length}`);
  console.error('');

  if (result.violations.length === 0) {
    console.error('✓ Dashboard query surfaces are fail-loud (no local .catch fallbacks).');
    return 0;
  }

  console.error('✗ Local `.catch(...)` found on dashboard query surfaces:');
  for (const v of result.violations) {
    console.error(`  - ${v.file}:${v.line}`);
  }
  console.error(
    '\nFix shape: remove local catch fallback and handle API failures through React Query `isError`.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

