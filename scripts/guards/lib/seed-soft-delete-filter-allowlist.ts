#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-soft-delete-filter-allowlist.ts
 *
 * PR-R1-14 — one-shot seed for the soft-delete-filter allowlist.
 *
 * Runs the guard, captures every violation, and emits fingerprint-format
 * allowlist entries citing `BUG-PR-R1-14-CASCADE-DRAIN-SOFT-DELETE`
 * (the umbrella tracking PR-R1-14's drain). Per CLAUDE.md §1.4
 * incremental adoption — each entry should be migrated when the file
 * is next touched (add `.whereNull('deleted_at')` or annotate with
 * `// @soft-delete-exempt: <reason>` if intentional).
 *
 * Run: `npx tsx scripts/guards/lib/seed-soft-delete-filter-allowlist.ts`
 */

import * as fs from 'fs';
import * as path from 'path';
import { runGuard } from '../check-soft-delete-filter';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-soft-delete-filter.allowlist');

interface SeedEntry {
  file: string;
  fingerprint: string;
  table: string;
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
      line: v.lineNo,
    });
  }

  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const lines = entries.map(
    (e) =>
      `${e.file} ${e.fingerprint}  # PR-R1-14 baseline original-lineno:${e.line} table=${e.table} | BUG-PR-R1-14-CASCADE-DRAIN-SOFT-DELETE — pre-existing soft-delete-filter omission; drain when file is next touched per CLAUDE.md §1.4 incremental adoption`,
  );

  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  const next = existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, next, 'utf-8');
  console.log(`Seeded ${entries.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
}

main();
