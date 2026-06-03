# Plan — BUG-528: LOC ratchet guard

[Plan agent invocation 2026-04-25 per PART 2 §B; first-principles per PART 6.1 #3. Phase A item 3 of approved structural prevention block.]

**Severity:** S1 (structural prevention; CI tooling).

## §0. Drift summary

No automatic LOC enforcement exists. CLAUDE.md mentions 600/1000 thresholds; nothing enforces them. Empirical god-files (verified):

- `MedicationsTab.tsx` — 3,368 LOC (3.37× hard cap)
- `SummaryTab.tsx` — 1,915 LOC
- `VivaTab.tsx` — 1,725 LOC
- `SettingsPage.tsx` — 1,601 LOC
- 38 files >600 LOC total across `apps/api/src` + `apps/web/src` + `packages/shared/src`.

BUG-420 (STRUCTURAL) flags this class. BUG-524 (S2) wants to split MedicationsTab — a refactor. The ratchet runs NOW to prevent compounding growth from BUG-522/523/520 follow-on work.

## §1. Verification (read-confirmed)

- `scripts/guards/` convention: TS via `tsx`, BUG-474 `check-no-vulnerable-uuid.ts` is the precedent (shebang `#!/usr/bin/env tsx`, `const repoRoot = resolve(__dirname, '..', '..')`, failures → `string[]`, exit 0/1/2).
- Top god-files enumerated empirically (38 files >600 LOC).
- CI does NOT auto-discover guards — every guard is its own named job + listed in `ci-gate.needs`. BUG-474 added `guard:no-vulnerable-uuid` to package.json but is NOT yet wired into ci.yml (latent gap; out-of-scope here).
- `tsx` + `vitest` already devDependencies. `guard:` script convention verified.
- Manual-drop chosen over auto-drop: prevents accidental shrinkage from locking in regressions; reviewer eyeball + atomic-flip discipline on `.github/` policy edits.

## §2. Fix shape

### §2.1 NEW `scripts/guards/check-file-size.ts` (~120 LOC)

Top-level constants `PLUS = 50`, `MINUS_NOTICE = 200`, `HARD_NEW_FILE = 1000`. `EXCLUDE_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.git', '.next']`.

Logic:
1. Read `.github/file-size-ceilings.txt`. Parse `<path>=<ceiling>` lines; comments (`#`) + blanks ignored. Malformed line → exit 2 with explicit error. Duplicate path → exit 2.
2. For each ceiling entry: count newlines (mirrors `wc -l`). If `current > ceiling + 50` → fail. If `current < ceiling - 200` → notice "ceiling can drop to N". If file missing → fail "drop entry or restore file".
3. Walk `apps/api/src`, `apps/web/src`, `packages/shared/src` for TS/TSX files NOT in ceiling list. If `current > 1000` → fail "split, OR add to ceilings.txt with BUG-cite".
4. Print notices, then failures, then exit 0/1.

### §2.2 NEW `.github/file-size-ceilings.txt`

Format: `<path>=<ceiling>` per line. Initial entries auto-populated from `find apps/api/src apps/web/src packages/shared/src -name '*.ts' -o -name '*.tsx' | xargs wc -l | awk '$1 > 600 && $2 != "total"'`. Header comment explains format + ratchet semantics + new-file rule.

### §2.3 Logic table

| State | Action |
|---|---|
| In list, current ≤ ceiling+50 | pass |
| In list, current > ceiling+50 | FAIL (split/refactor) |
| In list, current < ceiling-200 | pass + NOTICE "ceiling can drop to N" |
| In list, file missing | FAIL "drop entry or restore" |
| NOT in list, ≤1000 | silent pass |
| NOT in list, >1000 | FAIL "split or add to ceilings with BUG-cite" |
| Ceilings file missing | exit 2 |
| Malformed line | exit 2 |

### §2.4 Manual-drop only

NOTICE on shrinkage; no auto-edit of ceilings file. Reviewer eyeball + atomic-flip discipline on policy changes.

### §2.5 Wire-in

- `package.json` scripts: add `"guard:file-size": "tsx scripts/guards/check-file-size.ts"`
- `.github/workflows/ci.yml`: NEW `file-size-guard:` job (mirror `row-iface-drift-guard` shape); add to `ci-gate.needs:` list; add echo line to `ci-gate` summary.

## §3. UNION-up-front

N/A — pure CI policy mechanism.

## §4. §15 contract

N/A — no DB.

## §5. Test plan

NEW `scripts/guards/__tests__/check-file-size.test.ts` (vitest). Refactor §2.1 top-level execution into exported `runCheck()` for testability. Tests use `os.tmpdir()` — never mutate the real ceilings file.

NEW root `vitest.config.ts` scoped to `scripts/**/*.test.ts`. NEW `package.json` script: `"test:guards": "vitest run --config ./vitest.config.ts"`.

10 cases:

| ID | Setup | Expectation |
|---|---|---|
| FS-1 | ceiling=100, file=100 LOC | exit 0 |
| FS-2 | ceiling=100, file=101 LOC (+1) | exit 0 |
| FS-3 | ceiling=100, file=150 LOC (+50) | exit 0 |
| FS-4 | ceiling=100, file=151 LOC (+51) | exit 1 (PRE-FIX RED) |
| FS-5 | ceiling=300, file=100 LOC (–200) | exit 0, no notice |
| FS-6 | ceiling=300, file=99 LOC (–201) | exit 0 + NOTICE "ceiling can drop to 99" |
| FS-7 | NOT in list, 1001 LOC | exit 1 (PRE-FIX RED) |
| FS-8 | NOT in list, 999 LOC | exit 0 silent |
| FS-9 | ceilings file missing | exit 2 |
| FS-10 | malformed line (no `=`) | exit 2 |

## §6. Fix-registry rows (5)

| ID | File | Type | Pattern |
|---|---|---|---|
| `R-FIX-BUG-528-GUARD-EXISTS` | `scripts/guards/check-file-size.ts` | present | `^#!/usr/bin/env tsx` |
| `R-FIX-BUG-528-CEILINGS-FILE-EXISTS` | `.github/file-size-ceilings.txt` | present | `^apps/.*=[0-9]+` |
| `R-FIX-BUG-528-RATCHET-PLUS-50` | `scripts/guards/check-file-size.ts` | present | `^const PLUS = 50` |
| `R-FIX-BUG-528-RATCHET-MINUS-200` | `scripts/guards/check-file-size.ts` | present | `^const MINUS_NOTICE = 200` |
| `R-FIX-BUG-528-CI-WIRE-IN` | `package.json` | present | `^    "guard:file-size":` |

## §7. Files to modify

| File | Action |
|---|---|
| `scripts/guards/check-file-size.ts` | NEW |
| `.github/file-size-ceilings.txt` | NEW |
| `scripts/guards/__tests__/check-file-size.test.ts` | NEW |
| `vitest.config.ts` (root) | NEW |
| `package.json` | EXTEND (`guard:file-size`, `test:guards`) |
| `.github/workflows/ci.yml` | EXTEND (new job + ci-gate needs + echo) |
| `docs/quality/fix-registry.md` | EXTEND (5 anchors) |
| `docs/quality/bugs-remaining.md` | EXTEND (atomic flip BUG-528 → fixed) |

## §8. PART 2 §H/§I trigger assessment

- **L3:** unconditional, FIRES.
- **L4:** does NOT fire. CI tooling, no clinical surface.
- **L5:** FIRES per §I — adds new TS guard, modifies fix-registry, modifies ci.yml.

## §9. Risks + follow-ups

- §9.1 Stale ceilings file → manual-drop forces deliberate updates; +50 grace is conservative.
- §9.2 Cheating by adding to ceiling list → PR diff visible; L3 audits per BUG-526 checklist; header comment requires BUG-cite for new entries.
- §9.3 False-positive on auto-generated → seed scripts grandfathered at current LOC; `EXCLUDE_DIRS` covers `node_modules`/`dist`/`build`/`coverage`/`.git`/`.next`.
- §9.4 BUG-474 wire-in gap discovered (§1.3): `guard:no-vulnerable-uuid` is in package.json but not in ci.yml. NOT in BUG-528 scope; cascade-discovery note (file as separate BUG if not already tracked).

## §10. Acceptance

- Guard + ceilings file + test exist.
- 10 test cases (FS-1..FS-10) GREEN ×3 flake.
- FS-4, FS-7 demonstrably PRE-FIX RED.
- L1 GREEN, L3 PASS, L5 PASS, L4 not invoked.
- Atomic catalogue flip per Wave A-4/A-5 (BUG-527 hook validates).
- Cascade-discovery scan run per BUG-526 §D.
- Explicit user authorization before push.

Per PART 6.1: structural prevention. No quick fix. No abstraction wrapper. No scope creep into BUG-524 (god-file split is its own job).
