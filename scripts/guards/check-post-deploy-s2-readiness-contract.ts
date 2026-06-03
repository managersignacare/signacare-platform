#!/usr/bin/env tsx
/**
 * BUG-SA-109/110/111 + BUG-SCRIBE25-101/102/103/104 pre-work guard
 *
 * While these S2 rows are policy-deferred (post-deployment), this
 * contract ensures the agreed telemetry/schema/gating scaffolding
 * stays present and does not silently regress before GA hardening.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Target = {
  id: string;
  file: string;
  requiredPatterns: string[];
};

type Contract = {
  version: number;
  targets: Target[];
};

const ROOT = resolve(__dirname, '..', '..');
const CONTRACT_FILE = resolve(ROOT, '.github/post-deploy-s2-readiness-contract.json');

function main(): void {
  if (!existsSync(CONTRACT_FILE)) {
    console.error(`✗ missing contract file: ${CONTRACT_FILE}`);
    process.exit(1);
  }

  const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract;
  const failures: string[] = [];

  if (contract.version !== 1) {
    failures.push(`contract version must be 1 (found ${String(contract.version)})`);
  }
  if (!Array.isArray(contract.targets) || contract.targets.length === 0) {
    failures.push('contract must contain at least one target');
  }

  const seen = new Set<string>();
  for (const target of contract.targets ?? []) {
    if (seen.has(target.id)) failures.push(`duplicate target id '${target.id}'`);
    seen.add(target.id);

    const abs = resolve(ROOT, target.file);
    if (!existsSync(abs)) {
      failures.push(`[${target.id}] missing file: ${target.file}`);
      continue;
    }
    const source = readFileSync(abs, 'utf8');
    for (const pattern of target.requiredPatterns) {
      const re = new RegExp(pattern, 'm');
      if (!re.test(source)) {
        failures.push(`[${target.id}] missing pattern /${pattern}/ in ${target.file}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('✗ post-deploy S2 readiness contract failed');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('✓ post-deploy S2 readiness contract passed.');
  console.log('  contract: .github/post-deploy-s2-readiness-contract.json');
  console.log(`  targets:  ${contract.targets.length}`);
}

main();
