#!/usr/bin/env tsx
/* PR-R1-18 seed helper. */
import * as fs from 'fs';
import * as path from 'path';
import { runGuard } from '../check-safety-surface-audit-log';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-safety-surface-audit-log.allowlist');

interface SeedEntry {
  file: string;
  fingerprint: string;
  method: string;
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
    entries.push({ file: v.file, fingerprint: fp, method: v.method, line: v.lineNo });
  }

  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const lines = entries.map(
    (e) =>
      `${e.file} ${e.fingerprint}  # PR-R1-18 baseline original-lineno:${e.line} method=${e.method} | BUG-PR-R1-18-CASCADE-DRAIN-AUDIT-LOG — pre-existing audit-log gap on safety-surface mutation; AHPRA Standard 1 forensic-chain compliance; drain when service file is next touched`,
  );

  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  const next = existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, next, 'utf-8');
  console.log(`Seeded ${entries.length} entries.`);
}

main();
