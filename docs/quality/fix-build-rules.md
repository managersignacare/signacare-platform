# Fix / Build Rules — Signacare EMR

_The manual every engineer and every agent follows for every commit._

> Canonical companion policy: [Engineering Execution Standard (Gold-Standard / No-Deviation)](/Users/drprakashkamath/Projects/Signacare/docs/quality/engineering-execution-standard.md)
>
> Active freeze and authority map: [Governance Control Plane](/Users/drprakashkamath/Projects/Signacare/docs/quality/governance-control-plane.md)
>
> Use those documents for authoritative repo-wide execution policy and this document for detailed gate mechanics.

This document codifies what CLAUDE.md §9, §11, §13 enforces in code, plus the saved feedback rules in `.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/`. If those disagree with this document, this document is stale and must be updated. If reality disagrees with this document, STOP and reconcile before committing.

---

## 1. Plan before code — non-negotiable

Before a single line of production code changes for a non-trivial task:

1. Confirm the work is allowed under the active freeze in `docs/quality/governance-control-plane.md`.
2. Write a plan at `docs/plans/<bug-id-or-slug>.md` with five sections:
   - **Context** — why this change, who asked, what precedent exists.
   - **Existing code to reuse** — grep-verified list (functions, tables, routes, schemas) with file paths + line numbers. This proves you looked.
   - **Change surface** — every file to edit with the function / line. No abstractions invented to avoid per-file edits.
   - **Test plan** — the failing test shape written BEFORE the fix, plus which adjacent suites must remain green.
   - **Gate** — explicit list of which of the 10 checks below apply + which L3/L4/L5 agents the commit will invoke.

Skipping the plan is treated as skipping L1. Write "Not applicable — trivial fix" and a one-line justification if you genuinely believe the plan is overkill.

## 2. The 10-check gate — run for every commit

Layer 0a (agent-discipline + commit-msg attestation, per CLAUDE.md §11) gates run BEFORE this matrix on every trigger commit. The 10 checks below are the L1–L5 sequence that follows Layer 0a.

### 2.0 Pre-commit gate runbook (to prevent recurring failures)

Before every local commit and before every release build candidate, run the triage block below in order. This is the canonical map for recurring pre-commit failures and keeps fixes deterministic.

```bash
# 0) Save the staged delta and inspect scope
git status --short
git diff --cached --name-only --diff-filter=ACMR

# 1) Make hook governance mechanically verifiable
npm run guard:hook-enforcement

# 2) Run the effective pre-commit guard set locally
#    (exactly mirrors .husky/pre-commit for deterministic drift detection)
if [ -x ./.husky/pre-commit ]; then
  ./.husky/pre-commit
else
  npm run guard:claude-discipline --silent
  npm run guard:file-size --silent
  npm run guard:fk-aware-joins --silent
  npm run guard:response-shape-validated --silent
  npm run guard:service-auth-context --silent
  npm run guard:migration-rollback-discipline --silent
  npm run guard:jsonb-extraction --silent
  npm run guard:trx-not-db-inside-transaction --silent
  npm run guard:bugs-remaining-uniqueness --silent
  npm run guard:mapper-naming --silent
  npm run guard:zod-schema-parity --silent
  npm run guard:opt-locking-new-tables --silent
  bash .github/scripts/check-naming-conventions.sh
  bash .github/scripts/check-no-silent-catches.sh
  bash .github/scripts/check-fix-registry.sh
fi

# 3) If migration files are staged, run the elevated migration block
if git diff --cached --name-only --diff-filter=ACMR | grep -qE '^apps/api/migrations/[^/]+\.ts$'; then
  npm run guard:migration-rls-policy
  npm run guard:migration-index-discipline
  npm run guard:migration-convention
fi
```

#### Recurrence classifier (how to answer “it failed again” quickly)

| Symptom | Root class | Immediate action |
|---|---|---|
| `check-fix-registry.sh` fails with missing/renamed/extra row | Registry drift | Update anchors in `docs/quality/fix-registry.md`, or revert the untracked safety-surface change in this commit |
| `guard:hook-enforcement` fails | Hook wiring drift | Repair `.husky/pre-commit`, `.husky/commit-msg`, or `package.json` script entries before touching business code |
| `guard:service-auth-context` fails on `Service.ts` | Signature drift (`auth` param missing or out of order) | Stop and apply AuthContext-first signatures consistently in that service (no partial patches) |
| `guard:response-shape-validated` / `guard:zod-schema-parity` fail | Contract drift | Rebuild/expand canonical mapper + schema pair in the same commit |
| `guard:fk-aware-joins` / `guard:query-builder-columns` / `check-query-key-factories.sh` fail | Query schema/column drift | Regenerate touched SQL/joins against snapshot and fix all occurrences touched by the commit surface |
| `check-no-silent-catches` or `guard:no-fire-and-forget` fail | Error suppression regression | Replace silent pathways with observable fail-loud handling and user-facing copy where clinical impact is possible |
| `guard:jsonb-extraction` fails | JSONB field consumed without extractor | Add mapper-level extractor and type-safe schema output |
| `check-bugs-remaining-uniqueness` fails | Registry taxonomy drift | Close/open catalog rows in `docs/quality/bugs-remaining.md` and keep each BUG-ID in one row with clear status |
| `check-naming-conventions` fails | Syntax/style policy drift | Apply house conventions (no `/api/v1/` in frontend API client calls, parseInt radix, no anonymous global aliasing etc.) |

If one failure repeats on the same commit, switch to a surgical loop:

1. Fix the highest-severity recurring class first (security/safety first, then registry/discipline).
2. Re-run only the failed guard.
3. Re-run the full block above after each repair.

### 2.1 Hook governance enforcement (build-level)

`guard:hook-enforcement` is mandatory in the discipline chain. It mechanically verifies that:

- `.husky/pre-commit` still enforces `guard:claude-discipline` and `check-fix-registry`;
- `.husky/commit-msg` still enforces `guard:commit-claims` and `guard:review-attestation`;
- `package.json` still exposes those guard script entries.

If this guard fails, the commit is blocked until hook wiring is restored.

| # | Layer | Check | Command or agent | Blocking for |
|---|---|---|---|---|
| 1 | L1 | `tsc` clean on all 3 workspaces | `npx tsc --noEmit -p {apps/api,apps/web,packages/shared}/tsconfig.json` | every commit |
| 2 | L1 | `eslint` clean on touched files (no new `any`, no `void asyncCall()`, no silent `.catch()`, no literal `queryKey: [...]`) | `npx eslint <touched>` | every commit |
| 3 | L1 | All 17 CI guards green (`guard:*` + `.github/scripts/check-*.sh`) | `npm run guard:*` / bash | every commit |
| 4 | L1 | `check-fix-registry` green; every new fix has a row with a single-line ERE anchor | `bash .github/scripts/check-fix-registry.sh` | every commit |
| 5 | L2 | Failing test written BEFORE the fix (TDD evidence in commit body — pre-fix FAIL + post-fix PASS traces quoted) | `npx vitest run <file>` | every commit |
| 6 | L2 | Adjacent suites still green | `node apps/api/scripts/run-integration-tests.mjs` | every commit |
| 7 | L2 | New single-test flake check — run ×3 in isolation; zero flake | loop vitest run | every commit |
| 8 | L3 | `code-reviewer-general` agent: PASS on 8 prohibitions + 13-point audit + 6-step bug-fix protocol | `Agent subagent_type: code-reviewer-general` | risky-class |
| 9 | L4 | `clinical-safety-reviewer` agent: PASS on 8 patient-safety rules | `Agent subagent_type: clinical-safety-reviewer` | commits touching `features/(medications,clinical-notes,llm,scribe,ect,tms,risk,advance-directives,legal,clozapine)` or any auth/session/RBAC path |
| 10 | L5 | `architecture-reviewer` agent: PASS on 5 standards | `Agent subagent_type: architecture-reviewer` | commits touching `shared/`, `db/`, `auth/`, `llm/`, `integrations/` |

**Risky-class** = any commit touching `apps/api/src/shared/`, `apps/api/src/db/`, `apps/api/src/features/auth/`, `apps/api/src/features/llm/`, `apps/api/src/integrations/`, OR severity S0/S1, OR any migration/DDL, OR frontend+backend auth surface change.

### Absorb rule

Any REJECT / BLOCK from L3/L4/L5 MUST be absorbed in the SAME session before the commit lands. If a finding is beyond scope, PARK the whole commit in `docs/archive/older-reports/parked-work.md` (or a successor) with the finding reproduced verbatim. Never ship with an open REJECT / BLOCK.

### Stop rule

Two consecutive REJECT cycles on the same commit → HALT and escalate to the user with a written diagnosis. Do not continue iterating.

## 3. No silent deferral — no "Out of scope" fence

Plans must not hide legitimate future work behind an "Out of scope" section. If an item is real work that will eventually need doing, it belongs in the execution sequence as an explicit step — even if far out. Only genuine non-goals (things we are explicitly choosing NOT to do, ever) belong in an out-of-scope section, and those state WHY we are rejecting them.

## 4. No guessing, no assuming

Verify every fact before coding against it:

- Column names → open the migration file OR the snapshot (`apps/api/src/db/schema-snapshot.json`). Never guess.
- Table existence → grep the migrations OR the snapshot.
- Function signatures → Read the file. Do not assume based on the call site.
- External API shapes → read the spec OR the vendor SDK's `.d.ts`. Do not paraphrase.

If you can't verify, ASK. Blind coding against assumed state is the single most common source of regressions in this codebase.

## 5. No band-aids, no abstraction shortcuts

- **Gold standard only.** Each fix is the ACTUAL structural fix, not a monitoring wrapper or fail-safe that pretends to fix it. "We'll re-visit later" is not an engineering fix — it's a deferral that must be logged as such.
- **No abstraction shortcuts.** If a fix must be applied to 12 handlers, edit all 12. Do not create generic middleware / decorator / wrapper to reduce keystrokes. Defence in depth prefers explicit per-handler guards.
- **Stop on repeated patterns.** When the same error class recurs 2+ times, STOP iterating and investigate the structural cause. Don't chase symptoms.

### 5.1 Stale-item cleanup discipline (mandatory)

While touching a surface, remove stale items you encounter in that same surface unless removal is risky or out-of-bound for the current slice.

Stale items include:
- dead imports, dead branches, obsolete fallback paths, and commented-out legacy code;
- stale allowlist entries and stale guard exemptions (when the underlying violation is gone);
- stale docs/comments/checklist text that no longer matches runtime behavior;
- stale query keys/contracts that no longer have a live caller.

Rules:
- Do not defer obvious stale cleanup in touched files.
- If a stale item cannot be safely removed in-slice, record it explicitly in `docs/quality/bugs-remaining.md` with scope and risk.
- Never use stale artifacts as compatibility crutches once the structural replacement is in place.
- Add a **stale-sweep note** in the PR/commit body for touched surfaces: `removed` or `logged` (with bug id) is mandatory.

## 6. Per-commit mechanics

Every risky-class commit ships with:

- Regression test that pins the fix shape
- Fix-registry row (§9.5 of CLAUDE.md)
- Snapshot regeneration if a migration touched
- TypeScript + guards + vitest green
- §12.4 taxonomy annotation on every `knex.raw()` call
- `clinic_id` in every INSERT on an RLS table (§1.6)
- AuthContext-first signature for new service methods (§13)
- Handler has try/catch + `next(err)` (§3.1)
- Commit message cites bug_id + fix-registry anchor + TDD pre/post traces

## 7. One bug, one commit

Wave A-3 / A-4 / A-5 discipline. Never bundle across bug IDs. If two bugs genuinely share a single file surface (e.g. BUG-187 + BUG-264 + BUG-366b all touch `db.ts` pool config), the commit message makes the bundling explicit and the plan doc names it up front.

## 8. Split-SSoT policy

Sometimes a value must live in two places for performance or cross-language reasons (SQL literal + TS constant). When that happens:

- Document the split in the code comment at both sites.
- Add a CI guard that asserts the two copies agree.
- Catalogue the guard as a bug in `bugs-remaining.md` if it doesn't exist yet.

Silent drift between SQL literals and TS SSoTs without a guard is a BUG-355-family issue.

## 9. What is not a bug fix

These don't trigger the 10-check gate, but still need L1:

- Pure refactor PRs that touch no observable behaviour → no fix-registry row required.
- Scaffolding-only PRs that add no production code → no fix-registry row required.
- Doc-only PRs → no fix-registry row required, but still run L1.
- Any PR that only moves files (rename, reorganisation) → L1 only, plus a verification that all guards still pass.

Everything else is a bug fix or feature and triggers the full gate.

## 10. Commit message discipline

Follow conventional-commits but with Signacare extensions:

```
<type>(<scope>): <short summary>

<body — why, not what>

Gate:
- L1: [PASS|FAIL summary]
- L2: [pre-fix FAIL trace + post-fix PASS trace]
- L3 code-reviewer-general: [PASS|REJECT]
- L4 clinical-safety-reviewer: [PASS|BLOCK]  (if applicable)
- L5 architecture-reviewer: [PASS|REJECT]    (if applicable)

Fix-registry anchor: <R-FIX-...>
Catalogue: <state transition> in docs/archive/audit-2026-04-19/bug-catalogue-v2.yaml

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Scope prefixes: `fix(bug-NNN)`, `feat(<feature>)`, `chore(docs)`, `chore(catalogue)`, `test(<feature>)`, `perf(<target>)`, `refactor(<target>)`.

## 11. When in doubt

- Verify, don't assume.
- Plan, don't code.
- Ask, don't guess.
- Fix, don't paper over.
- Ship clean or don't ship.

These are non-negotiable. Deviation from them is the failure mode every earlier rule exists to prevent.

---

## Appendix A — the 18 CI guards (as of 2026-05-25)

| Guard | Catches |
|---|---|
| `check-fix-registry.sh` | every verified fix is still present |
| `check-no-stray-db-names.sh` | no drift in canonical DB / role names |
| `check-no-telecom.sh` | no unauthorised SMS / telephony imports |
| `check-acs-callers.sh` | every ACS import comes from `patient-outreach` |
| `check-naming-conventions.sh` | no `/api/v1/` prefix in apiClient, no `parseInt()` without radix, no Knex camelCase aliases |
| `check-mounted-routes-have-callers.sh` | no dead routes |
| `check-query-key-factories.sh` | no literal `queryKey: [...]` outside factories |
| `check-no-duplicate-api-types.sh` | frontend types don't re-declare shared types |
| `check-no-silent-catches.sh` | no `.catch(() => {})` etc. in production code |
| `check-no-orphan-migrations.sh` | every `.sql` has a tracked `.ts` wrapper |
| `check-trigger-has-audit-row.sh` | every state-mutating DB trigger emits audit_log |
| `guard:migration-convention` | §12.4 taxonomy annotations on every `knex.raw()` |
| `guard:snapshot-freshness` | `schema-snapshot.json` current vs migrations |
| `guard:row-iface-drift` | TS row interfaces match DB tables |
| `guard:code-columns` | `.insert`/`.update` writes target real columns |
| `guard:query-builder-columns` | query-builder column refs + raw table.column refs are real |
| `guard:frontend-urls` | every apiClient URL resolves to a backend handler |
| `guard:no-fire-and-forget` | no `void asyncCall()` / uncaught `setInterval` bodies |
| `guard:hook-enforcement` | pre-commit + commit-msg + attestation guard wiring cannot drift |

---

## Appendix B — 8 absolute prohibitions (from code-reviewer-general)

1. No band-aids / workarounds (root-cause fix only)
2. No new code that doesn't follow Signacare patterns (AppError, Zod, AuthContext, Pino)
3. No `any` / cast / suppressed warning without `@ts-justified: <reason>` inline
4. No strict DB queries without verified column names (CLAUDE.md §1.1)
5. No missing error narrowing (`instanceof Error` or similar)
6. No mandatory-protocol skips (TDD, fix-registry, plan-first)
7. No silent failure path (every async rejection is observable)
8. No history rewrite / destructive git action without explicit user approval

---

## Appendix C — 8 patient-safety rules (from clinical-safety-reviewer)

1. Patient safety > code elegance
2. Critical class detection — PHI, auth-boundary, clinical-workflow must fail loud
3. AI-content discipline — every LLM output has a disclaimer envelope, prompt-log gate, consent gate
4. Append-only clinical data — no UPDATE on signed notes, administered meds, closed episodes
5. Traceability — every clinical write links to a staff_id and a timestamp; audit_log captures old + new
6. PHI egress consent — every external send is consented or break-glass-audited
7. Break-glass integrity — break-glass sessions emit a mandatory audit row and expire on schedule
8. Graceful degradation — external dependency failure (Redis, HI Service, NPDS) must NOT disable clinical workflows

---

## Appendix D — 5 architectural standards (from architecture-reviewer)

1. Defence in depth — every critical invariant has ≥2 independent enforcement layers
2. Fail fast, fail loud — invariants violated throw with context; no silent null / silent skip
3. Single source of truth — constants / schemas / types declared once, referenced everywhere
4. Explicit over implicit — no magic, named helpers not inline clever, no side effects on module load
5. Reversibility — every migration has `down()`, every commit is `git revert`-able, every decision is documented in an ADR
