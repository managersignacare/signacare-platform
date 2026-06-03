#!/usr/bin/env tsx
/**
 * Phase R1 PR-R1-1.5 — one-shot migration of legacy lineno-based allowlist
 * entries to fingerprint-based entries.
 *
 * Run via: `npx tsx scripts/guards/lib/migrate-allowlists-to-fingerprint.ts`
 *
 * For each allowlist file, reads each `<file>:<lineno>  # comment` entry,
 * computes the fingerprint of the source line at that lineno, and rewrites
 * the entry as `<file> <fingerprint>  # comment | original-lineno: N`.
 *
 * Subsequent guard runs match by fingerprint (line-shift-resilient).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fingerprint } from './allowlist-fingerprint';

const ROOT = resolve(__dirname, '..', '..', '..');

const ALLOWLISTS = [
  'scripts/guards/check-fk-aware-joins.allowlist',
  'scripts/guards/check-response-shape-validated.allowlist',
];

function migrateFile(allowlistRelPath: string): { migrated: number; skipped: number } {
  const allowlistAbs = resolve(ROOT, allowlistRelPath);
  const txt = readFileSync(allowlistAbs, 'utf-8');
  const lines = txt.split('\n');
  const out: string[] = [];
  let migrated = 0;
  let skipped = 0;

  for (const line of lines) {
    // Preserve blank lines + pure comments verbatim.
    if (!line.trim() || line.trim().startsWith('#')) {
      out.push(line);
      continue;
    }

    // Extract data + comment portions.
    const hashIdx = line.indexOf('#');
    const data = (hashIdx >= 0 ? line.slice(0, hashIdx) : line).trim();
    const comment = hashIdx >= 0 ? line.slice(hashIdx) : '';

    // Already fingerprint format?
    if (/^(\S+)\s+([0-9a-f]{8})$/.test(data)) {
      out.push(line);
      continue;
    }

    // Legacy lineno format?
    const legacy = data.match(/^(\S+):(\d+)$/);
    if (!legacy) {
      out.push(line); // malformed; preserve verbatim
      skipped++;
      continue;
    }

    const file = legacy[1];
    const lineno = parseInt(legacy[2], 10);

    // Read source file to extract the line content.
    let src: string;
    try {
      src = readFileSync(resolve(ROOT, file), 'utf-8');
    } catch {
      out.push(line); // file unreadable; leave legacy
      skipped++;
      continue;
    }

    const srcLines = src.split('\n');
    const targetLine = srcLines[lineno - 1];
    if (targetLine == null || !targetLine.trim()) {
      out.push(line); // line out of range / empty; leave legacy
      skipped++;
      continue;
    }

    const fp = fingerprint(targetLine);
    // Rewrite: `<file> <fp>  # original-lineno: N | <previous comment>`
    const augmentedComment = comment
      ? comment.replace(/^#\s*/, `# original-lineno:${lineno} | `)
      : `# original-lineno:${lineno}`;
    out.push(`${file} ${fp}  ${augmentedComment}`);
    migrated++;
  }

  writeFileSync(allowlistAbs, out.join('\n'));
  return { migrated, skipped };
}

function main(): void {
  // eslint-disable-next-line no-console
  console.log('→ Migrating allowlists from <file>:<lineno> to <file> <fingerprint>');
  let totalMigrated = 0;
  let totalSkipped = 0;
  for (const path of ALLOWLISTS) {
    const { migrated, skipped } = migrateFile(path);
    totalMigrated += migrated;
    totalSkipped += skipped;
    // eslint-disable-next-line no-console
    console.log(`  ${path}: ${migrated} migrated, ${skipped} skipped`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n✓ Migration complete: ${totalMigrated} entries fingerprinted, ${totalSkipped} preserved as legacy`);
}

main();
