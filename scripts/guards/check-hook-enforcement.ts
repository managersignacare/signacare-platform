#!/usr/bin/env tsx
/**
 * Guard: enforce git-hook governance chain for pre-commit + commit-msg.
 *
 * Why:
 * - pre-commit / commit-msg hooks are the first safety rail for
 *   claim discipline and review-attestation enforcement.
 * - Hook drift can silently bypass policy while CI still appears healthy.
 *
 * This guard asserts required commands remain wired in:
 * - .husky/pre-commit
 * - .husky/commit-msg
 * - package.json scripts (command targets exist)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const PRE_COMMIT_REL = '.husky/pre-commit';
const COMMIT_MSG_REL = '.husky/commit-msg';
const PACKAGE_JSON_REL = 'package.json';

const REQUIRED_PRE_COMMIT_SNIPPETS = [
  'npm run guard:claude-discipline --silent',
  'bash .github/scripts/check-fix-registry.sh',
];

const REQUIRED_COMMIT_MSG_SNIPPETS = [
  'npm run guard:commit-claims --silent',
  'npm run guard:review-attestation --silent',
];

const REQUIRED_PACKAGE_SCRIPTS = [
  'guard:claude-discipline',
  'guard:commit-claims',
  'guard:review-attestation',
];

export interface Violation {
  file: string;
  reason: string;
}

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

function readText(root: string, rel: string): string | null {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

function validateSnippets(
  file: string,
  source: string | null,
  snippets: string[],
  out: Violation[],
): void {
  if (source === null) {
    out.push({ file, reason: 'file missing' });
    return;
  }
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      out.push({
        file,
        reason: `missing required hook command: ${snippet}`,
      });
    }
  }
}

function validatePackageScripts(root: string, out: Violation[]): void {
  const pkgPath = path.join(root, PACKAGE_JSON_REL);
  if (!fs.existsSync(pkgPath)) {
    out.push({ file: PACKAGE_JSON_REL, reason: 'file missing' });
    return;
  }
  let parsed: PackageJsonShape;
  try {
    parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJsonShape;
  } catch (err) {
    out.push({
      file: PACKAGE_JSON_REL,
      reason: `invalid JSON: ${(err as Error).message}`,
    });
    return;
  }
  const scripts = parsed.scripts ?? {};
  for (const script of REQUIRED_PACKAGE_SCRIPTS) {
    const value = scripts[script];
    if (!value || value.trim().length === 0) {
      out.push({
        file: PACKAGE_JSON_REL,
        reason: `missing required script: ${script}`,
      });
    }
  }
}

export function runGuard(opts?: { repoRoot?: string }): { violations: Violation[] } {
  const root = opts?.repoRoot ?? REPO_ROOT;
  const violations: Violation[] = [];

  validateSnippets(
    PRE_COMMIT_REL,
    readText(root, PRE_COMMIT_REL),
    REQUIRED_PRE_COMMIT_SNIPPETS,
    violations,
  );
  validateSnippets(
    COMMIT_MSG_REL,
    readText(root, COMMIT_MSG_REL),
    REQUIRED_COMMIT_MSG_SNIPPETS,
    violations,
  );
  validatePackageScripts(root, violations);

  return { violations };
}

function main(): number {
  const result = runGuard();
  console.error('→ check-hook-enforcement');
  console.error(`  violations: ${result.violations.length}`);
  console.error('');

  if (result.violations.length === 0) {
    console.error(
      '✓ Hook enforcement wiring intact (pre-commit + commit-msg + package scripts).',
    );
    return 0;
  }

  console.error('✗ Hook enforcement violations found:');
  for (const violation of result.violations) {
    console.error(`  - ${violation.file}: ${violation.reason}`);
  }
  console.error(
    '\nFix shape: restore hook wiring for guard:claude-discipline, ' +
      'guard:commit-claims, guard:review-attestation, and fix-registry pre-commit check.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
