# Deployment Readiness — Enterprise Baseline (v4)

**Last updated:** 2026-05-09  
**Execution context:** local-first completion, then GitHub push, then Windows Server deployment on Azure  
**Current production posture:** no live deployment, no live patient data

## Purpose

Define a hard, enterprise-grade readiness gate for this repository so deployment
promotion depends on verifiable code/schema/tests/guards evidence, not memory or
intent.

## Current Gate Snapshot (authoritative)

| Gate | Command | Result | Status |
|---|---|---|---|
| L1 compile | `npm run typecheck` | pass | ✅ |
| L0a discipline | `npm run guard:claude-discipline:ci` | pass | ✅ |
| L2 debt non-regression | `npm run guard:no-explicit-any-regression` | `1835 -> 1681` | ✅ |
| L1 lint | `npm run lint` | `1681` explicit-`any` errors | ❌ |
| L4 API integration | `npm run test:integration -w apps/api` | pass (latest full run) | ✅ |
| L4 DR drill | `npm run dr:restore-drill` | missing schema fingerprint | ❌ |
| L5 perf smoke | `npm run perf:baseline` | `localhost:4000` refused; `http_req_failed=100%` | ❌ |
| L5 browser | `npm run test:e2e` | full run not completed as authoritative gate | ⛔ |

## Blocking Defects Before Deployment Promotion

1. **`no-explicit-any` repo debt still fails lint globally**
   - Impact: build gate red; type-safety and regression detectability weakened.
2. **DR verification gate not provisioned**
   - Missing `docs/quality/expected-schema-fingerprint.txt` (or equivalent env input).
   - Impact: restore integrity cannot be proven.
3. **Perf smoke not executed against a running target**
   - Impact: no trustworthy latency/error baseline evidence (`http_req_failed` hard-fails at `100%`).
4. **Full browser gate not yet captured as a deterministic, complete run**
   - Impact: end-to-end release confidence incomplete.

## Enterprise Promotion Pipeline

### Phase A — Local Hard Gates (must all be green)

1. `npm run typecheck`
2. `npm run lint`
3. `npm run guard:claude-discipline:ci`
4. `npm run test:integration -w apps/api`
5. `npm run dr:restore-drill`
6. `npm run perf:baseline` (against active local API + seeded fixtures)
7. controlled Playwright gate (full or approved release-smoke subset with explicit policy)

No push to GitHub while any item above is red.

### Phase B — GitHub Hard Gates (branch and merge controls)

1. CI must re-run all local hard gates on clean runners.
2. Security gates must pass:
   - gitleaks pre-commit and CI
   - dependency/licensing policy checks
3. Trigger-commit review-attestation chain must pass on trigger commits.
4. No bypass merges on red checks.

### Phase C — Azure Hard Gates (Windows Server promotion)

1. Environment parity:
   - Node/runtime/version parity
   - DB migration source consistency
   - Redis policy (`allkeys-lru`) parity
2. Secret posture:
   - no plaintext secrets
   - key rotation evidence for previously leaked material
3. Deployment smoke:
   - `/health`, `/ready`, auth/login, patient list/detail, episode/note/medication core paths
4. Observability gates:
   - structured errors visible
   - correlation IDs and alert pipelines active
5. Rollback gate:
   - documented and tested rollback path before exposing real data/users

## Required Remediation Sequence (current)

1. Continue `BUG-466` tranche-based explicit-`any` elimination until `npm run lint` is globally green.
2. Materialize DR fingerprint artifact and enforce restore drill pass.
3. Re-run k6 baseline with a controlled local server target and store evidence.
4. Run authoritative L5 browser gate and archive evidence.
5. Only then push to GitHub for merge and Azure promotion.

## Regression Prevention Controls (non-negotiable)

- Keep `guard:no-explicit-any-regression` in discipline chain.
- Keep audit-path guards in discipline chain:
  - `guard:audit-reads-use-canonical-view`
  - `guard:bounded-await-audit-writer`
  - `guard:write-audit-timeout-policy`
- Keep runtime-honesty guards in discipline chain:
  - `guard:k6-thresholds`
  - `guard:dr-drill-fingerprint`
  - `guard:playwright-globalsetup-fail-closed`
- Every fixed deployment blocker must include:
  - code/migration change,
  - failing test reproduction,
  - regression test/guard where structurally applicable.

## Definition Of Done For "Ready To Deploy"

Ready means all three are true at once:

1. Local hard gates are green with current-session evidence.
2. GitHub CI gates are green on the exact commit intended for release.
3. Azure smoke + observability + rollback gates are green in the target environment.

Anything less is "in progress", not "deployment-ready".
