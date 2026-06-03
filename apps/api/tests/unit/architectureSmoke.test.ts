/**
 * Category 7 — Architecture smoke test.
 *
 * Runs dependency-cruiser as a subprocess from vitest and asserts:
 *   - Zero violations of the rules in .dependency-cruiser.cjs
 *     (no circular deps, no service→route imports, no src→test
 *      imports, no route→route except allowlisted sub-routers)
 *
 * This belongs in the default `pnpm test` run because it's fast
 * (~2-3s for the full 400-module crawl) and catches the entire
 * class of layering regressions at PR time, not at code review.
 *
 * If a future PR adds a new sub-router mount, this test will fail
 * with a precise error message identifying the violating import.
 * The fix is to either refactor the import OR add the file to the
 * pathNot allowlist in .dependency-cruiser.cjs (with a comment).
 *
 * Standard satisfied: ISO 25010 Maintainability (modularity, reusability),
 *                     ACHS Standard 1 (clinical software change control).
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');

describe('Architecture quality (dependency-cruiser)', () => {
  it('apps/api/src has zero forbidden import violations', () => {
    const res = spawnSync(
      'npx',
      [
        'depcruise',
        '--validate',
        '--config',
        '.dependency-cruiser.cjs',
        '--output-type',
        'err',
        'apps/api/src',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );

    // Capture both stdout and stderr — depcruise prints results to
    // stdout (the violation list) but its own diagnostics go to
    // stderr.
    const output = (res.stdout ?? '') + (res.stderr ?? '');

    if (res.status !== 0) {
      throw new Error(
        `dependency-cruiser found violations (exit ${res.status}):\n\n${output}\n\n` +
        `Each violation is a forbidden import per the rules in ` +
        `.dependency-cruiser.cjs. Either refactor the import or, if ` +
        `it's a legitimate sub-router mount or framework pattern, add ` +
        `the file path to the pathNot allowlist in that config (with ` +
        `a comment explaining why).`,
      );
    }

    // Sanity: depcruise should have actually walked the tree.
    expect(output).toMatch(/no dependency violations found.*\(\d+ modules/);
  }, 60_000);
});
