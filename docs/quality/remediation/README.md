# Remediation Takeover Packet

This folder is the repo-native handover system for the long-term remediation program.
It exists so execution continuity does not depend on chat history, agent memory, or plan-file folklore.

## Purpose

Use this packet when:

- the execution owner changes
- a paused remediation stream is resumed
- repo reality no longer matches the original slice wording
- an operator needs to audit what is active, what is blocked, and what counts as proof

## Authority Stack

When two sources disagree, use this order:

1. `CLAUDE.md`
2. [docs/quality/engineering-execution-standard.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/engineering-execution-standard.md)
3. [docs/quality/governance-control-plane.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/governance-control-plane.md)
4. [docs/quality/active-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/active-plan.md)
5. approved execution plan referenced by `active-plan.md`
6. this packet
7. current repo state (`git status`, file contents, test results)

## Execution Source Set For This Program

Per operator directive on 2026-05-07, remediation execution must read and follow all three of these together:

1. **Latest rules scaffold**
   - `CLAUDE.md`
   - `docs/quality/*.md` discipline and quality controls
2. **Latest audit artifacts**
   - `~/.claude/plans/phase-1-bug-sweep-ledger.md`
   - `~/.claude/plans/full-audit-report.md`
   - `~/.claude/plans/executable-test-results.md`
   - `~/.claude/plans/round-2-test-results.md`
   - [bugs-remaining.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/bugs-remaining.md)
3. **Latest remediation plan**
   - `~/.claude/plans/streamed-dazzling-shell.md`

This means execution must not fall back to stale slice wording from older planning when newer audit evidence or newer v4 class design contradicts it.

## Current Governance Warning

As of 2026-05-09:

- `active-plan.md` points to `~/.claude/plans/streamed-dazzling-shell.md`
- v4 is the active plan pointer for DoD lookups and phase sequencing
- remaining risk is not pointer drift; it is gate drift (stale status claims vs
  current command evidence)

Do not claim deployment readiness from historical green slices.
Always refresh global gates (`typecheck`, lint, integration, DR, perf, e2e) in
the current session before any push/promotion claim.

## Non-Negotiable Execution Rules

1. One owner, one active slice, one worktree.
2. No parallel edits in the same checkout.
3. Repo reality overrides stale slice assumptions.
4. No mixed List 1 / List 2 execution on the same slice.
5. No completion claim without named verification artifacts.
6. No scope broadening without updating the active-slice contract first.
7. No silent deferral, no "good enough", no band-aid closure.

## Files In This Packet

- [state-of-world.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/state-of-world.md)
- [bug-class-map.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/bug-class-map.md)
- [active-slice.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/active-slice.md)
- [verification-matrix.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/verification-matrix.md)
- [decision-log.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/decision-log.md)
- [rewrite-vs-remediation-decision-matrix.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/rewrite-vs-remediation-decision-matrix.md)
- [deployment-readiness-enterprise.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/deployment-readiness-enterprise.md)
- [no-explicit-any-burndown.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/no-explicit-any-burndown.md)
- [three-bucket-authoritative-plan.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/three-bucket-authoritative-plan.md)

## Start-Of-Shift Procedure For A New Owner

1. Read this file.
2. Read the latest audit artifacts listed above.
3. Read [state-of-world.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/state-of-world.md).
4. Confirm the current `git status` still matches the ledger.
5. Read [active-slice.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/active-slice.md).
6. Read [verification-matrix.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/verification-matrix.md).
7. Read [deployment-readiness-enterprise.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/deployment-readiness-enterprise.md) if the slice affects promotion/release claims.
8. Only then edit code.

If step 4 fails, stop and refresh the state ledger before touching product code.
