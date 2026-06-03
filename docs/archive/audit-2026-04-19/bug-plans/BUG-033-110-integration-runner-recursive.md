# BUG-033 / BUG-110 — Integration test runner flat readdir silently skips nested test files

> **Post-hoc backfill.** Plan doc created after commit. Extracted from commit body, catalogue entry, and fix-registry row.

## 1. Metadata

| | |
|---|---|
| Severity | S1 |
| Track | A |
| Wave | A-0 (pre-flight) |
| Change-class | standard |
| Commit SHA | `0057698` |
| Fix-registry anchor | R-FIX-INTEGRATION-RUNNER-RECURSIVE |
| Discovered | pre-plan |
| Closed | 2026-04-20 |

## 2. Diagnosis

**Root cause:** `apps/api/scripts/run-integration-tests.mjs` used a flat `readdirSync(dir)` call that did not recurse into subdirectories. Integration tests placed under `tests/integration/bughunt/` (and `dbPoolPressure.int.test.ts` once it was added) were silently skipped — `0 tests run, 0 failed` with no error.

**Classification:** isolated. One script, one call-site.

**Other instances:** grep confirmed only one `readdirSync` in the runner script; no siblings.

## 3. Approach

**Gold-standard fix:** replace flat `readdirSync` with a small recursive walk that respects the existing filename pattern (`*.test.ts` / `*.int.test.ts`). No new dependency; no change to vitest config.

**Downstream impact:** integration suites that had been silently skipping now run — which is the point. Any latent failures in previously-skipped suites surface; none found on first run.

**Pattern cited:** filesystem recursion via `readdirSync(..., { withFileTypes: true })` + `Dirent.isDirectory()` — standard node idiom used elsewhere in the codebase (e.g. snapshot generators).

## 4. Alternatives considered + rejected

| Alternative | Rejected because |
|---|---|
| Move all integration files back to flat `tests/integration/` | Loses the bughunt/ tier subfolder organisation; obscures which tier each test belongs to |
| Switch to a glob library (`fast-glob`, `globby`) | New dependency for a 10-line need; `readdirSync` recursion is sufficient |
| Let vitest's own glob handle discovery | Runner script has its own contract (emits per-file exit-code summary); bypassing it would require larger reporting rewrite |

## 5. Reviewer refinement trail

None recorded pre-commit — discovered during BUG-187 diagnostic phase when a new test file (`dbPoolPressure.int.test.ts`) was added and found not to run. Fix was trivial and one-shot.

## 6. Implementation outline

**Files touched:**
- `apps/api/scripts/run-integration-tests.mjs` — replaced flat readdir with recursive walk function.

**Key shape:**
```js
function walk(startDir) {
  const entries = readdirSync(startDir, { withFileTypes: true });
  return entries.flatMap((e) => {
    const full = path.join(startDir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}
```

## 7. Tests

**Red-first trace:** not formally captured (one-line fix). Validation was empirical: before the fix, `dbPoolPressure.int.test.ts` was not listed in the runner's output; after the fix, it appears and runs.

## 8. Verification trace

- Original failing scenario (test file nested under `bughunt/` not discovered) → resolved: appears in runner's per-file list.
- Nested-nested directories → resolved via full recursion.
- Symlink loops → not a concern in this repo (no symlinks under `tests/integration/`).

## 9. Residual risk

None. Fix is a small, mechanical correction. Any future regression would be caught by the integration tests themselves failing to appear in CI output.

## 10. CAB / change-control notes

None required — fix within existing BUG-033/110 scope, no new dependencies, no licence acceptance.

## 11. QA agent verdicts

Fix pre-dates the L1-L5 QA agent framework going live. Manual review only.
