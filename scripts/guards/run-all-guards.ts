#!/usr/bin/env tsx
/**
 * Global guard entrypoint:
 * runs the full mechanically-enforced guard pack from one command.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..', '..');
const PACKAGE_JSON = resolve(ROOT, 'package.json');
const A11Y_REPORT = resolve(ROOT, 'a11y-playwright-report.json');
const C3_ARTIFACT = resolve(ROOT, 'artifacts', 'c3', 'c3-coverage-evidence.json');

interface PackageJson {
  scripts?: Record<string, string>;
}

const ALWAYS_SKIP: Record<string, string> = {
  'guard:all': 'self',
  'guard:commit-claims': 'requires commit-msg path or PR context',
  'guard:pr-template-compliance': 'requires PR context',
  'guard:retrofit-allowlist-expiry': 'maintenance helper, not a validation guard',
};

function shouldSkipByPattern(script: string): string | null {
  if (script.startsWith('guard:seed-')) {
    return 'allowlist/bootstrap seeding helper, not validation';
  }
  return null;
}

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

function main(): number {
  const isCiContext = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageJson;
  const scripts = Object.keys(pkg.scripts ?? {}).filter((key) => key.startsWith('guard:')).sort();

  const selected: string[] = [];
  const skipped: Array<{ script: string; reason: string }> = [];

  for (const script of scripts) {
    const fixedSkip = ALWAYS_SKIP[script];
    if (fixedSkip) {
      skipped.push({ script, reason: fixedSkip });
      continue;
    }
    const patternSkip = shouldSkipByPattern(script);
    if (patternSkip) {
      skipped.push({ script, reason: patternSkip });
      continue;
    }
    if (script === 'guard:a11y-playwright-report' && !existsSync(A11Y_REPORT)) {
      skipped.push({ script, reason: 'requires a11y Playwright JSON artifact' });
      continue;
    }
    if (script === 'guard:c3-coverage-artifact') {
      if (!isCiContext) {
        skipped.push({ script, reason: 'CI-only artifact verdict validation' });
        continue;
      }
      if (!existsSync(C3_ARTIFACT)) {
        // We will generate this once before execution.
        continue;
      }
    }
    selected.push(script);
  }

  if (isCiContext && scripts.includes('guard:c3-coverage-artifact')) {
    console.log('→ pre-step: generating C3 coverage artifact for guard validation');
    const generateCode = run('npm', ['run', 'ci:generate-c3-coverage-artifact', '--silent']);
    if (generateCode !== 0) return generateCode;
    if (existsSync(C3_ARTIFACT)) {
      selected.push('guard:c3-coverage-artifact');
    } else {
      skipped.push({
        script: 'guard:c3-coverage-artifact',
        reason: 'artifact generation produced no output',
      });
    }
  }

  let failures = 0;
  for (const script of selected) {
    console.log(`\n→ ${script}`);
    const code = run('npm', ['run', script, '--silent']);
    if (code !== 0) {
      failures += 1;
    }
  }

  if (skipped.length > 0) {
    console.log('\nSkipped guards:');
    for (const entry of skipped) {
      console.log(`  - ${entry.script}: ${entry.reason}`);
    }
  }

  if (failures > 0) {
    console.error(`\n✗ guard:all failed (${failures} guard command(s) failed).`);
    return 1;
  }

  console.log('\n✓ guard:all passed.');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
