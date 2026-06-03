#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-jsonb-extraction-allowlist.ts
 *
 * Phase R1 PR-R1-4 — one-shot seed for the JSONB-extraction allowlist.
 *
 * Replays the same discovery + scan as `check-jsonb-extraction.ts` and
 * emits file-level allowlist entries for every TS file that currently
 * queries a JSONB-bearing table without a canonical mapper. Per
 * CLAUDE.md §1.7 incremental adoption — drains as routes migrate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { discoverJsonbColumns, findJsonbTablesInFile, hasJsonbExtractionMapper } from '../check-jsonb-extraction';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src', 'features');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-jsonb-extraction.allowlist');

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (e.isFile() && p.endsWith('.ts')) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

function main(): void {
  const jsonbTables = discoverJsonbColumns();
  const files = walk(SCAN_ROOT);
  const seedFiles: Array<{ file: string; tables: string[] }> = [];

  for (const f of files) {
    const source = fs.readFileSync(f, 'utf-8');
    // Use the SAME helpers as the runtime guard so the seed is
    // mechanically consistent with what the guard actually scans
    // (cycle-2 absorb: cycle-1 had a duplicated regex set that drifted).
    const used = findJsonbTablesInFile(source, jsonbTables);
    if (used.size === 0) continue;
    const allCols = new Set<string>();
    for (const cols of used.values()) for (const c of cols) allCols.add(c);
    if (hasJsonbExtractionMapper(source, allCols)) continue;
    if (/\/\/\s*@jsonb-extraction-exempt:\s*\S/.test(source)) continue;
    seedFiles.push({ file: path.relative(REPO_ROOT, f), tables: Array.from(used.keys()).sort() });
  }

  seedFiles.sort((a, b) => a.file.localeCompare(b.file));
  const lines = seedFiles.map(
    (e) => `${e.file}  # PR-R1-4 baseline tables=${e.tables.join(',')} | BUG-JSONB-EXTRACTION-MIGRATE-CONSUMERS — pre-existing JSONB-bearing-table query without canonical mapper per CLAUDE.md §1.7`,
  );

  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  const next = existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, next, 'utf-8');
  console.log(`Seeded ${seedFiles.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
}

main();
