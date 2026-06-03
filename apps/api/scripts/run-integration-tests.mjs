#!/usr/bin/env node
/**
 * Integration test runner — invokes vitest once per file in a fresh
 * subprocess so each integration suite gets a clean in-process Express
 * app, a clean Redis singleton, and a clean session cache.
 *
 * Why not a single `vitest run`: when the in-process server handles
 * multiple back-to-back logins from different test files in the same
 * process, the auth pipeline (audit-write batching + Knex transaction
 * lifecycle in the rls middleware) intermittently returns 500. The
 * helper detects this and skips affected suites cleanly, but the
 * cleanest behavior is to run each file in its own process so all
 * coverage is exercised on every CI run.
 *
 * Exit code: 0 if every spawned vitest run exited 0; non-zero
 * otherwise. Logs a one-line summary per file at the end.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const here = resolve(import.meta.dirname, '..');
const dir = join(here, 'tests', 'integration');
const requestedArgs = process.argv.slice(2);

// BUG-033: walk subdirectories so tier-specific tests under
// tests/integration/bughunt/ and future subdirs are discovered.
// Pre-fix behaviour was a flat readdirSync that silently skipped every
// test nested one level down.
function walk(startDir) {
  const out = [];
  const entries = readdirSync(startDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const full = join(startDir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(full));
    } else if (e.isFile() && (e.name.endsWith('.test.ts') || e.name.endsWith('.int.test.ts'))) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(dir)
  .map((abs) => relative(dir, abs))
  .sort();

if (files.length === 0) {
  console.error('No integration test files found in tests/integration/');
  process.exit(2);
}

const normalizeRequested = (value) => value
  .replace(/\\/g, '/')
  .replace(/^\.?\/*/, '')
  .replace(/^tests\/integration\//, '');

const requested = requestedArgs.map(normalizeRequested).filter(Boolean);
const selected = requested.length > 0
  ? files.filter((f) => requested.includes(f))
  : files;

if (requested.length > 0 && selected.length !== requested.length) {
  const available = new Set(files);
  const missing = requested.filter((f) => !available.has(f));
  console.error('Unknown integration test file(s):');
  for (const m of missing) {
    console.error(`  - tests/integration/${m}`);
  }
  process.exit(2);
}

const results = [];
let anyFailed = false;

console.log('\n════════════════════════════════════════');
console.log('Preflight: migrate integration schema');
console.log('════════════════════════════════════════');
const migrateRes = spawnSync('npm', ['run', 'migrate:dev'], {
  cwd: here,
  stdio: 'inherit',
});
if (migrateRes.status !== 0) {
  console.error('Preflight migration failed; aborting integration run.');
  process.exit(migrateRes.status ?? 1);
}

for (const f of selected) {
  const rel = `tests/integration/${f}`;
  console.log(`\n────────────────────────────────────────`);
  console.log(`▶ ${rel}`);
  console.log(`────────────────────────────────────────`);
  const res = spawnSync(
    'npx',
    ['vitest', 'run', '--config', 'vitest.integration.config.ts', rel],
    { cwd: here, stdio: 'inherit' },
  );
  const ok = res.status === 0;
  results.push({ file: rel, ok, code: res.status });
  if (!ok) anyFailed = true;
}

console.log('\n════════════════════════════════════════');
console.log('Integration test summary');
console.log('════════════════════════════════════════');
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  console.log(`  ${mark} ${r.file}${r.ok ? '' : `  (exit ${r.code})`}`);
}
console.log('════════════════════════════════════════');

process.exit(anyFailed ? 1 : 0);
