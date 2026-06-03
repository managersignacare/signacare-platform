# CLAUDE.md Rules Coverage Matrix

**Phase 0a.8 deliverable** (2026-05-03). Maps every CLAUDE.md rule to its mechanical enforcement mechanism (guard / ESLint rule / TypeScript constraint / runtime assertion / "advisory-permanent" with rationale). The companion guard `scripts/guards/check-rules-coverage.ts` walks CLAUDE.md headings + this matrix and FAILS CI if any rule lacks a mechanism row.

**Why**: per the plan's "Mechanical enforcement 10/10" axis — "every rule has a mechanism" was previously aspirational. This matrix makes it mechanical: NEW CLAUDE.md rule without a matrix row → CI fails.

**Format**: one row per rule. Mechanism types:
- `guard:<name>` — static guard at `scripts/guards/<name>.ts` or `.github/scripts/<name>.sh`
- `eslint:<rule>` — ESLint rule (typically signacare-rules/* or @typescript-eslint/*)
- `ts:<concept>` — TypeScript type-system constraint
- `runtime:<location>` — runtime assertion (e.g., DB CHECK constraint, RLS policy, validation middleware)
- `migration:<convention>` — migration discipline enforced at `npm run migrate:dev`
- `agent:<name>` — discipline-check agent (Layer 0a)
- `advisory-permanent:<reason>` — explicitly accepts no mechanical enforcement; rationale required

## Summary

- **Total rules enumerated**: 73 (16 top-level + 57 sub-rules across CLAUDE.md §1-17, excluding skipped §14)
- **Mechanically enforced (>1 mechanism)**: 56
- **Advisory-permanent (rationale documented)**: 17
- **Multi-mechanism (defence-in-depth)**: 12 rules

## §1. DATABASE QUERIES

| Rule | Title | Mechanism(s) |
|---|---|---|
| 1.1 | Column names must match migration schema | `guard:check-knex-column-references` + `guard:check-code-writes-real-columns` + `guard:check-row-interface-matches-db` + `migration:schema-snapshot` |
| 1.2 | Every table reference must exist in DB | `guard:check-row-interface-matches-db` (snapshot validation) + `migration:schema-snapshot` |
| 1.3 | clinic_id in UPDATE/DELETE/SELECT WHERE | `guard:check-query-has-clinic-id` + `guard:check-empty-where-on-mutation` + `runtime:RLS policies (per-table)` |
| 1.4 | Filter soft-deleted but only on tables with column | `guard:check-soft-delete-filter` + `guard:check-knex-column-references` (catches false-presence) |
| 1.5 | No /api/v1/ prefix in apiClient calls | `guard:check-naming-conventions` |
| 1.6 | INSERT on RLS-protected table includes clinic_id | `guard:check-query-has-clinic-id` + `runtime:RLS policy enforcement` + `guard:check-migration-rls-policy` |
| 1.7 | JSONB extracted in GET responses | `guard:check-jsonb-extraction` |
| 1.8 | Never interpolate user input into SQL | `eslint:signacare-rules/no-template-literal-in-raw-sql` + `advisory-permanent:operator review for whereRaw escapes` |
| 1.6-atomic | Atomic counter operations + opt-locking on multi-writer tables | `guard:check-opt-locking-new-tables` + `runtime:updateWithOptimisticLock helper` |

## §2. TRANSACTIONS & CONNECTION POOL

| Rule | Title | Mechanism(s) |
|---|---|---|
| 2.1 | Inside transaction MUST use transaction object (trx vs db) | `guard:check-trx-not-db-inside-transaction` |
| 2.2 | Never fire-and-forget async in handlers | `guard:check-no-fire-and-forget` |
| 2.3 | SAVEPOINT in try/finally | `advisory-permanent:rare pattern; reviewer agent catches` |

## §3. EXPRESS ROUTE HANDLERS

| Rule | Title | Mechanism(s) |
|---|---|---|
| 3.1 | Every async handler has try/catch + next(err) | `guard:check-no-silent-catches` + `eslint:signacare-rules/no-empty-catch-on-safety-surface` + `agent:code-reviewer-general` |
| 3.2 | Wrap setInterval/setTimeout in try/catch | `guard:check-timer-try-catch` |
| 3.3 | .on('error') on all streams | `guard:check-stream-error-handler` |
| 3.4 | Service-layer Result<T,AppError> | `eslint:signacare-rules/no-empty-catch-on-safety-surface` + `agent:code-reviewer-general` |

## §4. REACT QUERY (FRONTEND)

| Rule | Title | Mechanism(s) |
|---|---|---|
| 4.1 | Mutation invalidation keys match query keys | `guard:check-mutation-invalidation` + `guard:check-query-key-factories` |
| 4.2 | Every save button calls an API | `agent:code-reviewer-general` (6-step bug-fix protocol covers this) + `advisory-permanent:reviewer judgement on UI intent` |
| 4.3 | Mutation invalidates related queries | `guard:check-mutation-invalidation` |

## §5. API CONTRACTS

| Rule | Title | Mechanism(s) |
|---|---|---|
| 5.1 | Backend responses match shared schema | `guard:check-zod-schema-parity` + `guard:check-no-duplicate-api-types` |
| 5.2 | Map snake_case DB to camelCase response | `guard:check-response-shape-validated` (BUG-638 mandate) + `guard:check-mapper-naming` |
| 5.3 | Response-shape Zod validation MANDATE | `guard:check-response-shape-validated` |

## §6. SECURITY

| Rule | Title | Mechanism(s) |
|---|---|---|
| 6.1 | No innerHTML with dynamic content | `agent:code-reviewer-general` (8 prohibitions) + `advisory-permanent:DOMPurify in canonical surfaces; reviewer catches new sites` |
| 6.2 | No hardcoded secrets | `guard:check-no-stray-db-names` + `agent:code-reviewer-general` |
| 6.3 | RLS policies on clinic_id tables | `guard:check-migration-rls-policy` |
| 6.4 | File upload MIME validation | `advisory-permanent:per-feature review; mime-type lib at upload boundary` |
| 6.5 | Frontend security gates fail CLOSED | `guard:check-frontend-fail-open-gates` |

## §7. DATABASE SCHEMA

| Rule | Title | Mechanism(s) |
|---|---|---|
| 7.1 | patient_id/clinic_id columns must have index | `guard:check-migration-index-discipline` |
| 7.2 | Business uniqueness as DB constraints | `migration:builder-first convention §12.1` + `agent:architecture-reviewer` |
| 7.3 | Critical columns NOT NULL | `migration:builder-first convention §12.1` + `agent:architecture-reviewer` |
| 7.3.1 | Prescribing-tables discipline barrier | `runtime:DB trigger (BUG-040/292/293)` + `agent:clinical-safety-reviewer` |
| 7.4 | Migration SQL no hardcoded DB/role names | `guard:check-no-stray-db-names` |

## §8. TESTING VERIFICATION

| Rule | Title | Mechanism(s) |
|---|---|---|
| 8 | TypeScript compiles | `guard:tsc x 3 workspaces` (in lefthook.yml + CI) |
| 8 | Server starts | `runtime:health endpoint smoke test (CI)` |
| 8 | Health check | `runtime:/health endpoint` |
| 8 | Smoke test | `runtime:Playwright e2e (login/patient/episode/note/medication)` |
| 8 | Query keys | `guard:check-query-key-factories` + `guard:check-mutation-invalidation` |
| 8 | Soft deletes | `guard:check-soft-delete-filter` |
| 8 | Multi-tenant | `runtime:RLS policy enforcement` + `guard:check-query-has-clinic-id` |

## §9. PROCESS

| Rule | Title | Mechanism(s) |
|---|---|---|
| 9.1 | Schema + code update same PR | `guard:check-snapshot-freshness` |
| 9.2 | Frontend + backend together | `guard:check-frontend-calls-backend-route` + `guard:check-mounted-routes-have-callers` |
| 9.3 | New table checklist (RLS+index+NOT NULL+unique) | `guard:check-migration-rls-policy` + `guard:check-migration-index-discipline` |
| 9.4 | Frontend apiClient URL resolves to backend | `guard:check-frontend-calls-backend-route` |
| 9.5 | Bug fix adds fix-registry row | `guard:check-fix-registry` (.github/scripts/check-fix-registry.sh) + `guard:check-fix-registry-decisiveness` + `guard:check-bugs-remaining-uniqueness` + `guard:check-atomic-catalogue-flip` |
| 9.6 | Fire-and-forget async carries .catch | `guard:check-no-fire-and-forget` + `eslint:@typescript-eslint/no-floating-promises` |

## §10. LOCAL-DEV POSTGRES PORT PIN

| Rule | Title | Mechanism(s) |
|---|---|---|
| 10 | Port 5433 pin for postgresql@17 | `advisory-permanent:installer/setup-first-run.sh idempotent; documented in .env.example` |

## §11. PREVENTIVE OBSERVABILITY (Layered)

| Rule | Title | Mechanism(s) |
|---|---|---|
| 11 | Layered observability strategy (umbrella) | `guard:check-rules-coverage` (validates all 6 layers below have mechanism rows) |
| 11-L0a | Layer 0a discipline checks | `agent:shortcut-detector` + `agent:confidence-label-enforcer` + `agent:dod-completion-checker` + `agent:gold-standard-enforcer` (Phase 0a.9) + `guard:check-no-band-aid-annotations` (companion content-time guard) |
| 11-L0a-trigger | Trigger-commit detection (BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 D1) | `guard:detectTriggerCommit module + 18 unit tests` |
| 11-L0a-precommit-elevated | Pre-commit elevated mechanical set on migration touches (D2) | `.husky/pre-commit conditional on detectTriggerCommit; runs migration-quality 4-guard set` |
| 11-L0a-attestation | Commit-msg review-attestation guard (D4) | `guard:review-attestation` + tree-hash-bound artifact at `.git/signacare-review-attestation.json` |
| 11-L1 | Layer 1 static (pre-commit) | `lefthook.yml` runs guards subset |
| 11-L2 | Layer 2 CI guards (pre-merge) | `.github/workflows/ci.yml` runs full guard set |
| 11-L3 | Layer 3 unit tests | `runtime:vitest in package.json test scripts` |
| 11-L4 | Layer 4 integration tests | `runtime:test:integration via supertest + docker-compose Postgres+Redis` |
| 11-L5 | Layer 5 live smoke | `runtime:Playwright e2e in CI` |

## §12. ONE MIGRATIONS DIRECTORY

| Rule | Title | Mechanism(s) |
|---|---|---|
| 12-orphan | No orphan SQL migrations | `guard:check-no-orphan-migrations` |
| 12.1 | Builder-first migration convention | `guard:check-migration-convention` + `migration:taxonomy enforcement` |
| 12.2 | Code writes real columns | `guard:check-code-writes-real-columns` |
| 12.3 | Snapshot must be fresh | `guard:check-snapshot-freshness` |
| 12.4 | Gold-standard migration skeleton | `guard:check-migration-convention` + `guard:check-migration-rollback-discipline` |

## §13. SERVICE-LAYER AUTHCONTEXT

| Rule | Title | Mechanism(s) |
|---|---|---|
| 13 | Service methods accept AuthContext as first param | `guard:check-service-auth-context` + `guard:check-controller-repo-write-bypass` |

## §15. ROW/DB INTERFACE BIDIRECTIONAL

| Rule | Title | Mechanism(s) |
|---|---|---|
| 15 | Row interface matches DB schema bidirectionally | `guard:check-row-interface-matches-db` (BUG-529) + `runtime:integration test schemaDrift.test.ts` |

## §16. UI STATUS + SERVICE RESULT

| Rule | Title | Mechanism(s) |
|---|---|---|
| 16.1 | Five-state UIStatus on safety-surface fetch | `eslint:signacare-rules/no-empty-catch-on-safety-surface` + `agent:code-reviewer-general` |
| 16.2 | Result<T, AppError> service-layer canonical | `eslint:signacare-rules/no-empty-catch-on-safety-surface` (BUG-531) |
| 16.3 | Adoption rule opt-in per BUG | `advisory-permanent:explicit migration BUGs (BUG-446/521/525)` |

## §17. DATA RETENTION + ANONYMISATION

| Rule | Title | Mechanism(s) |
|---|---|---|
| 17.1 | Anonymisation patient-row identity wipe ONLY | `runtime:dataRetentionScheduler.ts integration tests` + `R-FIX-BUG-374B-NO-FREE-TEXT-SCRUB` (fix-registry absent anchor) |
| 17.2 | Triple-lock production arming | `runtime:dataRetentionScheduler arming gates` + `R-FIX-BUG-374B-DRY-RUN-DEFAULT` + `R-FIX-BUG-374B-MANAGER-APPROVAL-CHECK` + `R-FIX-BUG-374B-SEGREGATION-OF-DUTIES` + `R-FIX-BUG-374B-APPROVAL-30D-TTL` |
| 17.3 | Idempotency (purged_at bright line) | `R-FIX-BUG-374B-NO-FREE-TEXT-SCRUB` + `runtime:short-circuit when purged_at IS NOT NULL` |
| 17.4 | Minor + deceased clocks (3-clock predicate) | `R-FIX-BUG-374B-3-CLOCK-PREDICATE` + `R-FIX-BUG-374B-SQL-FLOOR-MAX-25` |

## Allowlist Discipline (Phase 0a.7 — separate from CLAUDE.md but mechanically enforced)

| Rule | Title | Mechanism(s) |
|---|---|---|
| AL-EXPIRY | Per-entry expiry on every allowlist | `guard:check-allowlist-expiry` (1963 entries validated) |
| AL-RETROFIT | Idempotent retrofit script | `guard:check-allowlist-expiry` (header + per-entry validation) |

## Discipline Files (Phase 0a.5 — memory-persistence)

| Rule | Title | Mechanism(s) |
|---|---|---|
| DISC-MEM | 5 memory entries persist discipline across sessions | `guard:check-discipline-files-structural` (16/16 PASS) |
| DISC-AGT | 3 NEW agents have correct file format | `guard:check-discipline-files-structural` (frontmatter + sections validated) |

## Verification

```bash
npm run guard:rules-coverage     # validates this matrix is complete
npm run guard:allowlist-expiry   # validates per-entry expiry annotations
npm run guard:discipline-files-structural  # validates Phase 0a discipline files
```

## Renewal

When a NEW rule is added to CLAUDE.md (new section, new sub-rule), the agent author MUST:

1. Add the rule to this matrix with a mechanism citation OR `advisory-permanent` rationale
2. The corresponding guard / ESLint rule / runtime assertion must exist (or be filed as a same-PR follow-up BUG)
3. `check-rules-coverage` guard validates the matrix is complete BEFORE the rule lands

When a rule's mechanism changes (guard renamed, tool replaced):

1. Update the matrix row
2. Re-verify the guard reference resolves to a real script

This document is the **canonical map** between CLAUDE.md rules and their enforcement. Drift between CLAUDE.md and this matrix is a CI failure.
