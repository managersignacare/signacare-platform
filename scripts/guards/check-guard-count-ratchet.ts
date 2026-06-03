#!/usr/bin/env tsx
/**
 * Repo-level guard count ratchet:
 * once the guard catalogue reaches a baseline, future PRs cannot reduce it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const PACKAGE_JSON = resolve(ROOT, 'package.json');
const RATCHET_FILE = resolve(ROOT, '.github', 'guard-ratchet.json');

interface RatchetPolicy {
  minGuardScripts: number;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function isCountedGuard(name: string): boolean {
  if (!name.startsWith('guard:')) return false;
  if (name.startsWith('guard:seed-')) return false;
  if (name === 'guard:retrofit-allowlist-expiry') return false;
  return true;
}

function main(): number {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageJson;
  const ratchet = JSON.parse(readFileSync(RATCHET_FILE, 'utf8')) as RatchetPolicy;
  const scriptNames = Object.keys(pkg.scripts ?? {});
  const guardNames = scriptNames.filter(isCountedGuard);
  const counted = guardNames.length;
  const minimum = ratchet.minGuardScripts;

  console.log('→ check-guard-count-ratchet');
  console.log(`  counted guards: ${counted}`);
  console.log(`  minimum allowed: ${minimum}`);

  if (!Number.isInteger(minimum) || minimum <= 0) {
    console.error('✗ .github/guard-ratchet.json has invalid minGuardScripts');
    return 1;
  }

  if (counted < minimum) {
    console.error('✗ guard catalogue regressed below ratchet minimum');
    console.error(`  expected at least ${minimum}, found ${counted}`);
    return 1;
  }

  console.log('✓ Guard catalogue count satisfies ratchet.');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
