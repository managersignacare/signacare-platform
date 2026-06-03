#!/usr/bin/env tsx
/**
 * C3-1 guard: protected CI runs must never use a11y dry-run mode.
 *
 * Enforces two layers:
 *  1) Runtime: if a protected ref / PR context has CI_A11Y_DRYRUN=true → fail.
 *  2) Workflow shape: ci.yml must not carry the known fail-open defaults/branches.
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_CI_WORKFLOW_PATH = resolve(ROOT, '.github', 'workflows', 'ci.yml');

export interface Violation {
  reason: string;
}

export interface RunGuardOpts {
  env?: NodeJS.ProcessEnv;
  ciWorkflowPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1;
  violations: Violation[];
}

function asBool(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

function isProtectedContext(env: NodeJS.ProcessEnv): boolean {
  if (asBool(env.GITHUB_REF_PROTECTED)) return true;
  const eventName = (env.GITHUB_EVENT_NAME ?? '').trim();
  if (eventName === 'pull_request' || eventName === 'pull_request_target') return true;
  const refName = (env.GITHUB_REF_NAME ?? '').trim();
  const baseRef = (env.GITHUB_BASE_REF ?? '').trim();
  return refName === 'main' || baseRef === 'main';
}

function checkWorkflowSource(workflowSource: string, workflowRelPath: string): Violation[] {
  const violations: Violation[] = [];
  if (/vars\.CI_A11Y_DRYRUN\s*\|\|\s*'true'/.test(workflowSource)) {
    violations.push({
      reason: `${workflowRelPath}: CI_A11Y_DRYRUN defaults to true (fail-open)`,
    });
  }
  if (/if\s+\[\s*"\$CI_A11Y_DRYRUN"\s*=\s*"true"\s*\]/.test(workflowSource)) {
    violations.push({
      reason: `${workflowRelPath}: dynamic a11y step still has an explicit dry-run branch`,
    });
  }
  return violations;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const env = opts.env ?? process.env;
  const workflowPath = opts.ciWorkflowPath ?? DEFAULT_CI_WORKFLOW_PATH;
  const workflowRelPath = relative(ROOT, workflowPath);
  const violations: Violation[] = [];

  const protectedContext = isProtectedContext(env);
  const dryRunEnabled = asBool(env.CI_A11Y_DRYRUN);
  if (protectedContext && dryRunEnabled) {
    violations.push({
      reason:
        'Protected CI context has CI_A11Y_DRYRUN=true (forbidden: a11y gate would fail-open).',
    });
  }

  try {
    const workflowSource = readFileSync(workflowPath, 'utf8');
    violations.push(...checkWorkflowSource(workflowSource, workflowRelPath));
  } catch (error) {
    violations.push({
      reason: `${workflowRelPath}: could not read workflow file (${error instanceof Error ? error.message : String(error)})`,
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-a11y-ci-no-dryrun');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ Protected CI contexts cannot run a11y in dry-run mode.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

