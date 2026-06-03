import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-a11y-ci-no-dryrun';

const TMP_BASE = join(tmpdir(), 'check-a11y-ci-no-dryrun-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeWorkflowFixture(name: string, source: string): string {
  const filePath = join(TMP_BASE, `${name}.yml`);
  writeFileSync(filePath, source, 'utf8');
  return filePath;
}

describe('check-a11y-ci-no-dryrun', () => {
  it('passes when protected context has dry-run disabled and workflow has no fail-open pattern', () => {
    const workflowPath = writeWorkflowFixture(
      'pass',
      `
name: CI
jobs:
  a11y:
    steps:
      - run: npx playwright test --project=chromium e2e/accessibility/
`,
    );
    const result = runGuard({
      ciWorkflowPath: workflowPath,
      env: {
        GITHUB_REF_PROTECTED: 'true',
        CI_A11Y_DRYRUN: 'false',
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when protected context uses dry-run', () => {
    const workflowPath = writeWorkflowFixture(
      'runtime-fail',
      `
name: CI
jobs:
  a11y:
    steps:
      - run: npx playwright test --project=chromium e2e/accessibility/
`,
    );
    const result = runGuard({
      ciWorkflowPath: workflowPath,
      env: {
        GITHUB_REF_PROTECTED: 'true',
        CI_A11Y_DRYRUN: 'true',
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('CI_A11Y_DRYRUN=true'))).toBe(true);
  });

  it('fails when workflow contains known fail-open dry-run default/branch', () => {
    const workflowPath = writeWorkflowFixture(
      'workflow-fail',
      `
name: CI
jobs:
  a11y:
    steps:
      - name: Dynamic axe-core e2e scan
        env:
          CI_A11Y_DRYRUN: \${{ vars.CI_A11Y_DRYRUN || 'true' }}
        run: |
          if [ "$CI_A11Y_DRYRUN" = "true" ]; then
            echo dry run
          fi
`,
    );
    const result = runGuard({
      ciWorkflowPath: workflowPath,
      env: {
        GITHUB_REF_PROTECTED: 'true',
        CI_A11Y_DRYRUN: 'false',
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('defaults to true'))).toBe(true);
    expect(result.violations.some((v) => v.reason.includes('dry-run branch'))).toBe(true);
  });
});

