#!/usr/bin/env tsx
/**
 * check-zero-byte-tracked-files — BUG-D10-GUARD-ZERO-BYTE (S1)
 *
 * Fails when git-tracked regular files have zero bytes.
 * Zero-byte tracked files in this repo have repeatedly been stale artifacts
 * (empty sqlite DBs, empty scaffolds, accidental scratch files) that bypass
 * normal review because they produce little/no diff signal.
 */

import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';

function listTrackedFiles(): string[] {
  try {
    const out = execSync('git ls-files -z', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\0').filter((line) => line.length > 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`✗ check-zero-byte-tracked-files: unable to enumerate tracked files (${message})`);
    process.exit(2);
  }
}

function main(): void {
  console.log('→ check-zero-byte-tracked-files');
  const tracked = listTrackedFiles();
  const offenders: string[] = [];

  for (const path of tracked) {
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      if (st.size === 0) offenders.push(path);
    } catch {
      // Ignore transient filesystem races; git index is the source of truth.
    }
  }

  if (offenders.length === 0) {
    console.log(`✓ No zero-byte tracked files (${tracked.length} tracked entries scanned).`);
    process.exit(0);
  }

  console.error(`✗ ${offenders.length} zero-byte tracked file(s) detected:`);
  for (const path of offenders) {
    console.error(`  - ${path}`);
  }
  console.error('\nRemove stale files or replace with real template/content before merge.');
  process.exit(1);
}

main();
