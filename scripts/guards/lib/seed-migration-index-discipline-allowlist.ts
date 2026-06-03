#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-migration-index-discipline-allowlist.ts
 *
 * PR-R1-16 — one-shot seed for the migration-index-discipline allowlist.
 *
 * Runs the guard, captures every violation, and emits fingerprint-format
 * allowlist entries citing `BUG-PR-R1-16-CASCADE-DRAIN-MIGRATION-INDEXES`.
 * Per CLAUDE.md §7.1 incremental adoption — baseline migrations carry
 * pre-existing index gaps that drain via either ad-hoc index-add migrations
 * (CREATE INDEX IF NOT EXISTS) or via the table being touched in a future
 * migration that adds the index then.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runGuard } from '../check-migration-index-discipline';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-migration-index-discipline.allowlist');

interface SeedEntry {
  file: string;
  fingerprint: string;
  table: string;
  column: string;
  line: number;
}

function main(): void {
  const result = runGuard();
  if (result.exitCode === 2) {
    console.error('✗ guard returned exit 2 (snapshot read failed). Cannot seed.');
    process.exit(2);
  }

  const entries: SeedEntry[] = [];
  for (const v of result.violations) {
    const filePath = path.join(REPO_ROOT, v.file);
    let lineContent: string;
    try {
      const src = fs.readFileSync(filePath, 'utf-8');
      const lines = src.split('\n');
      lineContent = lines[v.lineNo - 1] ?? '';
    } catch {
      lineContent = v.preview;
    }
    const fp = fingerprint(lineContent);
    if (!fp) continue;
    entries.push({
      file: v.file,
      fingerprint: fp,
      table: v.table,
      column: v.column,
      line: v.lineNo,
    });
  }

  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const lines = entries.map(
    (e) =>
      `${e.file} ${e.fingerprint}  # PR-R1-16 baseline original-lineno:${e.line} table=${e.table} column=${e.column} | BUG-PR-R1-16-CASCADE-DRAIN-MIGRATION-INDEXES — pre-existing index gap; drain via ad-hoc index-add migration per CLAUDE.md §7.1 incremental adoption`,
  );

  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  const next = existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, next, 'utf-8');
  console.log(`Seeded ${entries.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
}

main();
