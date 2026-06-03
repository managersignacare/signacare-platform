# Signacare EMR QA Agent — Operator Guide

5-level review system that validates every code fix against principal-engineer rules.

## Files in this directory

| File | Purpose |
|---|---|
| `level-1-static.ts` | 20 deterministic AST/regex checks. Runs every commit. ~5s. |
| `level-2-narrative.ts` | 13 PR-body + protocol checks. Runs every commit. ~1s. |
| `README.md` | This file. |

## Subagents (LLM-judgement)

Registered in `.claude/agents/`:

| Subagent | Invocation | Covers |
|---|---|---|
| `code-reviewer-general` | `Agent(subagent_type: "code-reviewer-general", ...)` | L3 — 8 prohibitions + 7 judgement dimensions |
| `clinical-safety-reviewer` | `Agent(subagent_type: "clinical-safety-reviewer", ...)` | L4 — 8 clinical rules |
| `architecture-reviewer` | `Agent(subagent_type: "architecture-reviewer", ...)` | L5 — 5 architectural standards |

Fresh context per invocation. No memory of executor conversation.

## State ledger

`docs/audit-2026-04-19/bug-catalogue-v2.yaml` — machine-readable source of truth for all 255 bugs. Validate after every edit:

```bash
npx yaml-lint docs/audit-2026-04-19/bug-catalogue-v2.yaml
```

## Invocation workflow (per commit)

Every commit follows this sequence:

```
1. Executor writes the fix.
2. Deterministic L1 runs (pre-commit hook):
     tsx scripts/qa-agent/level-1-static.ts --staged
   Fail → executor fixes, re-runs.

3. Executor pushes to branch, opens PR.
4. CI runs L1 + L2:
     tsx scripts/qa-agent/level-1-static.ts --base main --head HEAD
     PR_BODY="$(gh pr view $PR --json body -q .body)" tsx scripts/qa-agent/level-2-narrative.ts
   Fail → PR blocked. Executor amends PR body / commits.

5. CI spawns L3/L4/L5 subagents (all risky; relevant for standard; optional for trivial):
     - L3 always, all commit classes
     - L4 if clinical surface touched
     - L5 if structural or touches shared/db/auth/llm/integrations
   Subagent returns [PASS] or [REJECT] with violations.
   Any REJECT → PR blocked until addressed.

6. Human Reviewer sign-off for risky commits only. Sampled for standard.
7. Merge.
```

## Human-executor usage

When I (the executor) prepare a fix:

```bash
# Pre-commit local validation
tsx scripts/qa-agent/level-1-static.ts --staged

# Pre-PR-push local validation (with PR body ready)
PR_BODY="$(cat pr-body.md)" tsx scripts/qa-agent/level-2-narrative.ts --pr-body pr-body.md
```

## Invocation cost

| Level | Cost | Time |
|---|---|---|
| L1 deterministic | $0 | ~5s (dominated by tsc) |
| L2 deterministic | $0 | <1s |
| L3 subagent | ~$1 | 30-90s |
| L4 subagent | ~$1 | 30-90s |
| L5 subagent | ~$1 | 30-60s |
| **Per risky-class commit** | ~$3 | ~2 min |
| **Per trivial-class commit** | ~$0 if L1+L2 pass | ~6s |

At 210 PRs over 12 months: ~$400-600 total LLM cost. Well within programme budget.

## Maintenance cadence

| Event | Action |
|---|---|
| New principal-engineer rule adopted | Update L1/L2 rules + subagent prompts + version bump |
| L1/L2 false-positive rate >5% | Tune rule + add fixture test |
| Subagent reject rate >25% on trivial class | Calibrate prompt, possibly relax |
| Appeal rate >10% per wave | CAB reviews prompt design |
| Schema change in bug-catalogue-v2.yaml | Bump schema_version + update loader |

## Fixture tests (required before QA agent goes live — v4 D.3)

Location: `tests/qa-agent-fixtures/`

Required before enabling:
- 20 pass-case fixtures (well-formed PRs that should PASS all levels)
- 20 fail-case fixtures (each violates one specific rule)
- CI job runs all fixtures against L1+L2 nightly; any regression blocks the merge

## Debugging a rejection

```bash
# See all violations for your changes
tsx scripts/qa-agent/level-1-static.ts --head HEAD | jq '.violations'

# See narrative failures with context
PR_BODY="$(cat .git/PR_BODY)" tsx scripts/qa-agent/level-2-narrative.ts

# Inspect subagent transcript (after CI run)
# Subagent output is logged to the PR's CI artefacts
```

## Appeal mechanism

If a PASS rejection is a false positive:

1. Executor adds a `QA-APPEAL:` section to PR body with evidence.
2. Reviewer (human) approves/denies the appeal.
3. Appeal logged in `docs/qa-agent/appeals-log.md` with outcome.
4. If appeals rate >10% per wave → CAB reviews rule design.

## Rule reference

All rules documented canonically in:
- `docs/audit-2026-04-19/EXECUTION-PLAN-v3-FULL.md` PART 3 + PART 12
- `docs/qa-agent/rules-spec-v1.md` (frozen spec, see v4 D.3)

---

Built 2026-04-19. Version 1.0.
