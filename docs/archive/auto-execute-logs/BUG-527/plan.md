# Plan — BUG-527: atomic-flip CI guard

[Plan agent invocation 2026-04-26 per PART 2 §B; first-principles per PART 6.1 #3. Phase A item 2 of approved structural prevention block.]

**Severity:** S1 (structural prevention; CI tooling).

## §0. Drift summary

The atomic-flip discipline (every safety-surface fix lands with `docs/quality/fix-registry.md` AND `docs/quality/bugs-remaining.md` in the SAME commit) currently lives in `feedback_atomic_catalogue_flip.md` (memory) + L4 reviewer culture. Empirically held across 12+ session BUGs (verified via `git diff-tree`: BUG-443 `149c742`, BUG-445 `6e714d5`, BUG-521 `df6ae44`, BUG-526 `4c64b26`, BUG-444 `2c13f17` all flipped both files atomically). But there is no CI gate — discipline only. BUG-527 closes the gap with a CI-side guard backed by a flat allowlist.

## §1. Verification (read-confirmed)

- `.github/scripts/` conventions: `#!/usr/bin/env bash`, `set -uo pipefail`, `::error::` annotations, exit 0/1/2. Reference shape: `check-fix-registry.sh`.
- Allowlist convention: `.github/scripts/<name>.allowlist` exists for 4 guards. BUG-527 uses `.github/safety-surfaces.txt` at root of `.github/` (consistent with .txt convention for L5 SSoT files cross-linked from docs).
- `.github/workflows/ci.yml` exists; jobs added as `# ── N. <Name> Guard ──` blocks; each added to `needs:` of `all-checks-passed` + result-echo block.
- `.husky/` does NOT exist; `.git/hooks/` only has `*.sample`. No pre-commit framework. **BUG-527 is purely CI-side.**
- L4 §F scope uses regex syntax `{a|b|c}` and nested `(a|b|c)` — not bash-glob compatible. BUG-527 converts to flat prefix-match allowlist.
- Empirical past-commit validation: 5 spot-checked safety-surface commits all flipped both catalogue files atomically.
- Caveat: BUG-444 (S1) touched `apps/api/src/middleware/licenseMiddleware.ts` which is NOT in L4 §F's `features/` scope. Known gap; logged as §9.6 follow-up.

## §2. Fix shape

### §2.1 NEW `.github/scripts/check-atomic-flip.sh` (~140 LOC bash)

Two modes via positional arg `$1`:
- `ci` (default): `git diff --name-only HEAD~1 HEAD`; reads commit message via `git log -1 --format=%B`.
- `pre-commit`: `git diff --cached --name-only`; reads `.git/COMMIT_EDITMSG`.

Logic:
1. Compute changed file list per mode.
2. Check commit message for `[skip-atomic-flip: <reason>]` exemption directive — if present, exit 0 with audit echo.
3. Load `.github/safety-surfaces.txt` allowlist; fail with exit 2 if missing.
4. Iterate changed files × allowlist patterns (prefix match). Test files (`*.test.ts(x)`, `*.spec.ts(x)`, `*/tests/*`, `*/__tests__/*`) routed to `TEST_HITS` array (exempt per AF-7); non-test safety-surface files routed to `SAFETY_HITS`.
5. If `SAFETY_HITS` empty → exit 0.
6. If `docs/quality/fix-registry.md` OR `docs/quality/bugs-remaining.md` in changed list → exit 0 (atomic flip present).
7. Else exit 1 with `::error::` + listing of safety-surface files + required catalogue files + escape hatch instructions.

### §2.2 NEW `.github/safety-surfaces.txt`

Flat one-prefix-per-line file. API features (medications, clinical-notes, llm, scribe, ect, tms, risk, advance-directives, legal, clozapine, auth, audit, prescriptions, pathology, patient-app, patient-outreach, power-settings) + web features (medications, clinical-notes, llm, scribe, receptionist, beds) + 7 named patient-detail-tab files (MedicationsTab, VivaTab, SummaryTab, PathologyTab, MhaTab, LegalTab, EctTmsTab). Comments allowed (`#`).

### §2.3 Wire-in to `.github/workflows/ci.yml`

New job:
```yaml
atomic-flip-guard:
  name: Atomic Flip Guard
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 2  # need HEAD~1
    - name: Run atomic-flip guard
      run: bash .github/scripts/check-atomic-flip.sh ci
```

Wire-in 3 places: new job block, `needs:` of `all-checks-passed`, result-echo line.

### §2.4 Cross-link in L4 checklist §F

Append: "The canonical machine-readable form of this scope is `.github/safety-surfaces.txt`. **The .txt is the SSoT** — this section reflects it. Update both in the same commit per §G."

## §3. UNION-up-front

N/A.

## §4. §15 contract

N/A.

## §5. Test plan

NEW `.github/scripts/__tests__/check-atomic-flip.test.sh` — bash integration test, self-contained (uses `mktemp -d` + ephemeral `git init` repos). 10 cases:

| ID | Setup | Mode | Expected exit |
|---|---|---|---|
| AF-1 | Stage `apps/api/src/features/auth/authController.ts` ONLY | pre-commit | 1 (RED pre-fix) |
| AF-2 | Stage same + `docs/quality/fix-registry.md` | pre-commit | 0 |
| AF-3 | Stage same + `docs/quality/bugs-remaining.md` | pre-commit | 0 |
| AF-4 | Stage `apps/api/src/db/migrations/20260101_foo.ts` ONLY | pre-commit | 0 (not safety surface) |
| AF-5 | Stage `apps/web/src/features/medications/Foo.tsx` ONLY | pre-commit | 1 (RED pre-fix) |
| AF-6 | Stage `apps/api/src/features/auth/authController.ts` + `[skip-atomic-flip: hotfix]` in commit msg | pre-commit | 0 |
| AF-7 | Stage `apps/api/src/features/auth/authController.test.ts` ONLY | pre-commit | 0 (test exempt) |
| AF-S1 | Allowlist file missing | pre-commit | 2 |
| AF-S2 | Bogus mode `nonsense` | n/a | 2 |
| AF-S3 | Two-commit synthetic repo, latest commit violates | ci | 1 (RED pre-fix) |

Pre-fix RED: AF-1, AF-5, AF-S3 fail because hook doesn't exist. 3× flake check after fix.

## §6. Fix-registry rows (5)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-527-HOOK-EXISTS` | `.github/scripts/check-atomic-flip.sh` | present | `^#!/usr/bin/env bash` |
| `R-FIX-BUG-527-SAFETY-SURFACE-LIST-EXISTS` | `.github/safety-surfaces.txt` | present | `^apps/api/src/features/` |
| `R-FIX-BUG-527-CATALOGUE-DELTA-CHECK` | `.github/scripts/check-atomic-flip.sh` | present | `bugs-remaining\.md` |
| `R-FIX-BUG-527-EXEMPTION-DIRECTIVE` | `.github/scripts/check-atomic-flip.sh` | present | `skip-atomic-flip` |
| `R-FIX-BUG-527-CI-WIRE-IN` | `.github/workflows/ci.yml` | present | `^  atomic-flip-guard:` |

## §7. Files to modify

| File | Action |
|---|---|
| `.github/scripts/check-atomic-flip.sh` | NEW |
| `.github/safety-surfaces.txt` | NEW |
| `.github/scripts/__tests__/check-atomic-flip.test.sh` | NEW |
| `.github/workflows/ci.yml` | EXTEND (new job + needs + echo) |
| `docs/quality/l4-reviewer-checklist.md` | EXTEND §F (SSoT cross-link) |
| `docs/quality/fix-registry.md` | EXTEND (5 anchors) |
| `docs/quality/bugs-remaining.md` | EXTEND (atomic flip BUG-527 → fixed) |

## §8. PART 2 §H/§I trigger assessment

- **L3:** unconditional, FIRES.
- **L4:** does NOT fire. CI tooling, no clinical surface.
- **L5:** FIRES per §I — adds CI primitive, modifies fix-registry, adds new pinned config (.txt) cross-linked from L4 doc as SSoT.

## §9. Risks + follow-ups

- §9.1 False-positive on legitimate refactor → exemption directive `[skip-atomic-flip: <reason>]`.
- §9.2 Cosmetic catalogue delta would pass → L3 reviewer's job to validate quality.
- §9.3 `--no-verify` bypass → CI-side check, unaffected; `feedback_no_quick_fix.md` already forbids it.
- §9.4 Allowlist staleness → BUG-526 §G "same-commit update" rule extends to .txt.
- §9.5 Lazy fix-registry rows → existing `check-fix-registry.sh` validates row structure; BUG-527 is complementary.
- **§9.6 KNOWN GAP**: middleware/repository safety surfaces not in §F (e.g. BUG-444 touched `licenseMiddleware.ts`). File as separate follow-up BUG to extend §F + .txt scope.
- §9.7 Test-file regression slipping through AF-7 → existing test-file guards cover that.
- §9.8 Pre-commit framework follow-up: future BUG could wire into husky.

## §10. Acceptance

- 5 fix-registry anchors pass.
- 10 test cases (AF-1..7 + AF-S1..S3) GREEN ×3 flake.
- AF-1, AF-5, AF-S3 demonstrably RED before hook lands.
- CI workflow includes the new job; `fetch-depth: 2` set.
- L4 §F cross-links to `.github/safety-surfaces.txt` as SSoT.
- The implementation commit ITSELF passes the hook (it touches `.github/scripts/` AND `docs/quality/fix-registry.md` AND `docs/quality/bugs-remaining.md` — recursive validation).
- L1 GREEN, L3 PASS, L5 PASS, L4 not invoked.
- Atomic catalogue flip per Wave A-4/A-5.
- Explicit user authorization before push.

Per PART 6.1: structural prevention for atomic-flip discipline. No quick fix. No abstraction wrapper — bash + flat allowlist is the right shape. No scope creep into validating CONTENT of catalogue deltas (L3's job).
