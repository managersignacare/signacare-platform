# Plan — Catalogue BUG-355 through BUG-362 + BUG-354b as real entries

## 1. Context

During the 2026-04-23 user-intercept + retroactive L3/L4/L5 reviews on BUG-353/BUG-354, nine new work items surfaced. They are currently referenced in commit bodies + `docs/plans/bug-354-forward-fix-audit-log.md` + `docs/audit-2026-04-22/parked-work.md` but NOT in the machine-readable catalogue at `docs/audit-2026-04-19/bug-catalogue-v2.yaml`. Without catalogue entries they have no severity, no track, no wave assignment, no regression-test contract, no `blocked_by` graph. Per CLAUDE.md §9.5 + PART 13.3 of the master plan, every open item must have a catalogue row.

## 2. Existing code to reuse

- **Catalogue YAML shape** (`docs/audit-2026-04-19/bug-catalogue-v2.yaml`): each entry is `{bug_id, severity, track, wave, state[, blocked_by, notes]}`. Header comments enumerate legal values. Proven shape from 100+ existing entries.
- **phase_0_5_follow_ups section** already exists at lines ~end of file with BUG-348–354. New entries belong in the same section (matching wave naming `Phase-0.5-follow-up`).
- **PART 13.3.I + 13.3.J** of `/Users/drprakashkamath/.claude/plans/sleepy-roaming-meteor.md` already captures the text description — copy into catalogue `notes` field.

## 3. Change surface

- **EDIT** `docs/audit-2026-04-19/bug-catalogue-v2.yaml` — append 9 entries (one YAML `- bug_id:` block each) under the `phase_0_5_follow_ups:` section.

## 4. Entries to add

| bug_id | severity | track | wave | state | blocked_by | rationale |
|---|---|---|---|---|---|---|
| BUG-354b | S2 | A | Phase-0.5-follow-up | open | [BUG-354] | L4/L5 non-blocking recommendations from 2026-04-23 review: RAISE WARNING on audit-write failure; capture OLD.role/is_active/deleted_at/clinic_id in old_data; T4/T5 tests for soft_deleted + clinic_transferred; RAISE WARNING on 'unknown' reason fallback; operational Sentry alerts |
| BUG-355 | S3 | A | Phase-0.5-follow-up | open | — | Operational-role SSoT between SQL literal and TS `OPERATIONAL_ONLY`; add `check-operational-role-ssot.sh` CI guard |
| BUG-356 | S1 | A | Phase-0.5-follow-up | open | — | Access-token revocation — wire `apps/api/src/middleware/jwtBlacklist.ts` into `authMiddleware` between `jwt.verify` and user hydration; blocker for BUG-353 re-attempt |
| BUG-357 | S2 | A | Phase-0.5-follow-up | open | [BUG-354] | General pattern: `audit_log` emission on every security-state-changing DB trigger; one-commit follow-up once second such trigger exists |
| BUG-358 | S3 | A | Phase-0.5-follow-up | open | [BUG-357] | CI guard `check-trigger-has-audit-row` — asserts every `CREATE TRIGGER` on security-critical tables is paired with `INSERT INTO audit_log` in function body |
| BUG-359 | S3 | B | B-11 | open | — | 10 `parseInt()`-without-radix violations (naming-conv guard): NursingPage.tsx, AssessmentsTab.tsx, ReportsPage.tsx |
| BUG-360 | S3 | B | B-11 | open | — | 4 silent-catch violations (no-silent-catches guard): llmRoutes.ts:381,454,513; CorrespondenceTab.tsx:587 |
| BUG-361 | S3 | B | B-11 | open | — | 1 stray-db-name violation in WARN mode (Phase 0.5 PR 2 will flip to FAIL); find + apply dynamic current_database() / current_setting('app.owner_role') per §7.4 |
| BUG-362 | S2 | A | Phase-0.5-follow-up | open | [BUG-354] | Stale-admin-slot reconciliation sweep — BUG-354 trigger only fires forward; existing clinics with nominated/delegated admin pointing at already-ineligible staff are invisible. One-off migration that NULLs stale slots + emits ADMIN_SLOT_CLEARED_RECONCILIATION audit rows |

## 5. Test plan

- No code change, no runtime behaviour, no new test suite.
- L2.5 test plan equivalent: after the edit, grep the catalogue for each new bug_id must return exactly one match (uniqueness assertion).
- No adjacent suite can regress (no code touched).

## 6. Gate

| # | Check | Apply |
|---|---|---|
| L1.1 tsc | N/A (YAML only) | skipped |
| L1.2 eslint | N/A (YAML only) | skipped |
| L1.3 guards | all 17 must remain in the same state as before this edit | run all |
| L1.4 registry | no new fix-registry row (CLAUDE.md §9.5 exception: doc-only) | skipped |
| L2.5 | Grep-based uniqueness check for each new bug_id | run |
| L2.6 | N/A (no behaviour change) | skipped |
| L2.7 | N/A | skipped |
| L3 | docs change — not risky-class per CLAUDE.md | SKIPPED with rationale |
| L4 | docs change — not clinical-safety code | SKIPPED with rationale |
| L5 | docs change — not arch-affecting code | SKIPPED with rationale |

Per PART 13.1: "RISKY-class (L3 mandatory): any commit touching shared/, db/, auth/, llm/, integrations/, OR severity S0/S1, OR any migration/DDL, OR frontend+backend auth surface change." A YAML catalogue edit does not touch any of those. L3/L4/L5 would produce noise without value. Documenting the skip rationale in the commit body is the discipline equivalent per PART 13.1 absorb-rule ("explicit skip with rationale" > "silent skip").

## 7. Explicit non-goals

- Not shipping code for any of these 9 bugs.
- Not opening PRs or branches — catalogue entries are the planning artefact.
- Not triaging into specific sub-waves beyond Phase-0.5-follow-up / B-11 assignment.
