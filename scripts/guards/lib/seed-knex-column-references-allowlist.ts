#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-knex-column-references-allowlist.ts
 *
 * PR-R1-13 — one-shot seed for the Knex column-references allowlist.
 *
 * Runs the guard, captures every violation, and emits fingerprint-format
 * allowlist entries citing `BUG-NEW-S1-CASCADE-DRAIN-KNEX-COLUMN-REFS`
 * (the umbrella tracking PR-R1-13's drain). Per CLAUDE.md §13 / §15
 * incremental adoption — each entry should be migrated to a real
 * column-name fix when the file is next touched.
 *
 * Each violation may produce a duplicate entry (multiplicity-aware) when
 * the same line-content appears multiple times in the file.
 *
 * Run: `npx tsx scripts/guards/lib/seed-knex-column-references-allowlist.ts`
 *
 * Output is appended to scripts/guards/check-knex-column-references.allowlist.
 */

import * as fs from 'fs';
import * as path from 'path';
import { runGuard } from '../check-knex-column-references';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-knex-column-references.allowlist');

interface SeedEntry {
  file: string;
  fingerprint: string;
  table: string | null;
  column: string;
  line: number;
  kind: string;
  preview: string;
}

function main(): void {
  const result = runGuard();
  if (result.exitCode === 2) {
    console.error('✗ guard returned exit 2 (snapshot read failed). Cannot seed.');
    process.exit(2);
  }

  const entries: SeedEntry[] = [];
  for (const v of result.violations) {
    // Read the source file to get the line content (the violation only
    // carries a 180-char preview — for fingerprint stability we want the
    // full line).
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
      kind: v.kind,
      preview: v.preview,
    });
  }

  // Sort by file, then by line, for tidy output.
  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const lines = entries.map(
    (e) =>
      `${e.file} ${e.fingerprint}  # PR-R1-13 baseline original-lineno:${e.line} kind=${e.kind} ghost=${e.table ?? '<no-table>'}.${e.column} | BUG-NEW-S1-CASCADE-DRAIN-KNEX-COLUMN-REFS — pre-existing ghost-column reference; drain when file is next touched per CLAUDE.md §15 incremental adoption`,
  );

  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  const next = existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, next, 'utf-8');
  console.log(
    `Seeded ${entries.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`,
  );
  console.log(
    `\nRun \`npx tsx scripts/guards/check-knex-column-references.ts\` to verify the guard is now GREEN against the seeded baseline.`,
  );
}

main();
