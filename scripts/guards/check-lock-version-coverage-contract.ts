#!/usr/bin/env tsx
/**
 * BUG-ARCH-LOCK-VERSION-COVERAGE
 *
 * Structural guard for optimistic-lock coverage:
 * 1) required multi-writer tables expose `lock_version` in generated row-types
 * 2) critical write paths keep lock-version mutation semantics
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type WritePath = {
  id: string;
  file: string;
  requiredPatterns: string[];
};

type Contract = {
  version: number;
  tables: string[];
  writePaths: WritePath[];
};

const ROOT = resolve(__dirname, '..', '..');
const CONTRACT_FILE = resolve(ROOT, '.github/lock-version-coverage-contract.json');

function main(): void {
  if (!existsSync(CONTRACT_FILE)) {
    console.error(`✗ missing lock-version coverage contract: ${CONTRACT_FILE}`);
    process.exit(1);
  }

  const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract;
  const failures: string[] = [];

  if (contract.version !== 1) {
    failures.push(`contract version must be 1 (found ${String(contract.version)})`);
  }
  if (!Array.isArray(contract.tables) || contract.tables.length === 0) {
    failures.push('contract must include at least one table');
  }

  const seenTables = new Set<string>();
  for (const table of contract.tables ?? []) {
    if (seenTables.has(table)) failures.push(`duplicate table '${table}'`);
    seenTables.add(table);

    const typeFile = resolve(ROOT, 'apps/api/src/db/types', `${table}.ts`);
    if (!existsSync(typeFile)) {
      failures.push(`[${table}] missing generated row-type file: apps/api/src/db/types/${table}.ts`);
      continue;
    }
    const source = readFileSync(typeFile, 'utf8');
    if (!/\block_version\b/.test(source)) {
      failures.push(`[${table}] missing lock_version in generated row-type`);
    }
  }

  const seenWrites = new Set<string>();
  for (const wp of contract.writePaths ?? []) {
    if (seenWrites.has(wp.id)) failures.push(`duplicate writePath id '${wp.id}'`);
    seenWrites.add(wp.id);

    const absolute = resolve(ROOT, wp.file);
    if (!existsSync(absolute)) {
      failures.push(`[${wp.id}] missing file: ${wp.file}`);
      continue;
    }
    const source = readFileSync(absolute, 'utf8');
    for (const pattern of wp.requiredPatterns) {
      const re = new RegExp(pattern, 'm');
      if (!re.test(source)) {
        failures.push(`[${wp.id}] missing pattern /${pattern}/ in ${wp.file}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('✗ lock-version coverage contract failed');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('✓ lock-version coverage contract passed.');
  console.log(`  contract: .github/lock-version-coverage-contract.json`);
  console.log(`  tables:   ${contract.tables.length}`);
  console.log(`  writes:   ${contract.writePaths.length}`);
}

main();
