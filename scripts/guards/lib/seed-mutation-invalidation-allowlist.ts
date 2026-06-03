#!/usr/bin/env tsx
import * as fs from 'fs';
import * as path from 'path';
import { runGuard } from '../check-mutation-invalidation';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-mutation-invalidation.allowlist');

function main(): void {
  const result = runGuard();
  if (result.exitCode === 2) { console.error('✗ exit 2'); process.exit(2); }
  const entries: { file: string; fingerprint: string; line: number }[] = [];
  for (const v of result.violations) {
    let lineContent = '';
    try { lineContent = fs.readFileSync(path.join(REPO_ROOT, v.file), 'utf-8').split('\n')[v.lineNo - 1] ?? ''; } catch { void 0; }
    const fp = fingerprint(lineContent);
    if (!fp) continue;
    entries.push({ file: v.file, fingerprint: fp, line: v.lineNo });
  }
  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  const lines = entries.map(
    (e) => `${e.file} ${e.fingerprint}  # PR-R1-22 baseline original-lineno:${e.line} | BUG-PR-R1-22-CASCADE-DRAIN-MUTATION-INVALIDATION — pre-existing useMutation without invalidate; add onSuccess invalidateQueries per CLAUDE.md §4.3`,
  );
  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  fs.writeFileSync(ALLOWLIST_PATH, existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n', 'utf-8');
  console.log(`Seeded ${entries.length} entries.`);
}

main();
