#!/usr/bin/env tsx
/* PR-R1-19 seed helper. */
import * as fs from 'fs';
import * as path from 'path';
import { runGuard } from '../check-controller-repo-write-bypass';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-controller-repo-write-bypass.allowlist');

function main(): void {
  const result = runGuard();
  if (result.exitCode === 2) { console.error('✗ exit 2'); process.exit(2); }
  const entries: { file: string; fingerprint: string; method: string; line: number }[] = [];
  for (const v of result.violations) {
    const filePath = path.join(REPO_ROOT, v.file);
    let lineContent = '';
    try { lineContent = fs.readFileSync(filePath, 'utf-8').split('\n')[v.lineNo - 1] ?? ''; } catch { void 0; }
    const fp = fingerprint(lineContent);
    if (!fp) continue;
    entries.push({ file: v.file, fingerprint: fp, method: `${v.repoIdent}.${v.method}`, line: v.lineNo });
  }
  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  const lines = entries.map(
    (e) => `${e.file} ${e.fingerprint}  # PR-R1-19 baseline original-lineno:${e.line} call=${e.method} | BUG-PR-R1-19-CASCADE-DRAIN-CONTROLLER-WRITE-BYPASS — pre-existing controller-side repo-write call; refactor to service-layer call accepting AuthContext per CLAUDE.md §13`,
  );
  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  fs.writeFileSync(ALLOWLIST_PATH, existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n', 'utf-8');
  console.log(`Seeded ${entries.length} entries.`);
}

main();
