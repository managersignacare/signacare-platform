# Verification Matrix

This file separates repo-global truth from slice-local truth.
That distinction matters because the repo currently has known red global baselines.

## Rule 1

Never say "the repo is green" when only a bounded slice was verified.

## Lint Execution Contract (Post BUG-466)

1. `npm run lint:changed` (or `lint:changed:staged` / `lint:changed:main`) is
   the tranche-iteration lint signal.
2. `npm run lint` is the closure gate for repo-wide lint truth.
3. DoD/decision-log language must distinguish these:
   - tranche claim: “scoped lint passed”
   - closure claim: “global lint passed”

## Current Known Global Baseline

From the latest execution session (2026-05-11):

- root `typecheck`: **passing**
- root `guard:claude-discipline:ci`: **passing**
- root `lint`: **passing**
- full API integration matrix: **passing in latest full run** (see `state-of-world.md`)
- targeted recheck of former red suites:
  - `tests/integration/limitCeilings.int.test.ts` => pass
  - `tests/integration/reportsRoutesHealth.int.test.ts` => pass
- DR drill: **failing** (missing expected schema fingerprint artifact)
- k6 baseline: **failing** when no local API process is running
- full Playwright matrix: **not yet completed in a clean authoritative run**
- integration runtime policy: Redis uses canonical `allkeys-lru` (BUG-197 posture)

Therefore, most remediation slices can only claim:

- targeted workspace green
- targeted guard green
- targeted test green

until the owning class explicitly restores the broader baseline.

## Deployment Readiness Implication

Until the red global gates above are cleared, no slice may claim
"deployment-ready" or "release-ready". It may only claim bounded closure for
its explicit scope.

## Verification Layers

| Layer | Purpose | Typical command shape | Blocking rule |
|---|---|---|---|
| `0a` | claim discipline | `npm run guard:claude-discipline:ci` | required for any serious slice claim |
| `L1` | compile / lint / syntax | targeted `tsc` + targeted `eslint` | required |
| `L2` | repo guards | specific guard commands for the touched rule | required when guard exists |
| `L3` | unit tests | targeted `vitest` / pure-function tests | required for helper or policy logic |
| `L4` | integration tests | targeted real-DB or API tests | required when slice changes runtime behavior |
| `L5` | browser/live proof | Playwright or equivalent smoke | required when slice changes UI or full user path |

## Verified Commands For Current Local Scaffolding

### API observability helper slice

- `npx tsc --noEmit -p apps/api/tsconfig.json`
- `npx eslint apps/api/src/shared/observability/withTiming.ts apps/api/tests/unit/withTiming.test.ts`
- `npx vitest run --config vitest.config.ts tests/unit/withTiming.test.ts`
- `npx eslint apps/api/src/shared/observability/withTimeout.ts apps/api/tests/unit/withTimeout.test.ts`
- `npx vitest run --config vitest.config.ts tests/unit/withTimeout.test.ts`

### Shared domain-command slice

- `npx tsc --noEmit -p packages/shared/tsconfig.test.json`
- `npx eslint packages/shared/src/domainCommands.ts packages/shared/src/domainCommands.test.ts packages/shared/src/index.ts`
- `npx vitest run --config vitest.config.ts src/domainCommands.test.ts`

### Discipline umbrella

- `npm run guard:claude-discipline:ci`

### A2 dedupe foundation slice

- `npx tsc --noEmit -p apps/api/tsconfig.json`
- targeted ESLint on touched A2 files
- `npx vitest run --config vitest.config.ts tests/unit/auditDedupeKey.test.ts tests/auditOutbox.test.ts` in `apps/api`
- `npm run migrate:dev` in `apps/api`
- `npx vitest run --config vitest.integration.config.ts tests/integration/auditLogDedupe.int.test.ts` in `apps/api`
- `npm run guard:migration-convention`
- `npm run guard:claude-discipline:ci`

### A2 bounded audit-timeout slice

- `npx tsc --noEmit -p apps/api/tsconfig.json`
- targeted ESLint on touched auth/guard files
- `npx vitest run --config vitest.config.ts tests/unit/authControllerAuditObservability.test.ts` in `apps/api`
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-bounded-await-in-login-path.test.ts`
- `npx tsx scripts/guards/check-bounded-await-in-login-path.ts`
- `K6_BASE_URL=http://localhost:4002 k6 run --vus 1 --duration 20s scripts/k6/baseline.js`
- `npm run guard:claude-discipline:ci`

### A2 timeout-fallback semantics slice

- `npx tsc --noEmit -p apps/api/tsconfig.json`
- targeted ESLint on touched audit/guard files
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/auditWriteTimeoutFallback.test.ts tests/auditOutbox.test.ts tests/unit/auditDedupeKey.test.ts`
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-bounded-await-in-audit-writer.test.ts`
- `npx tsx scripts/guards/check-bounded-await-in-audit-writer.ts`
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/auditLogDedupe.int.test.ts`
- `npm run guard:claude-discipline:ci`

### A2 caller-consistency sweep slice

- `npx tsc --noEmit -p apps/api/tsconfig.json`
- targeted ESLint on touched auth/guard files
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-write-audit-timeout-policy.test.ts`
- `npx vitest run --config apps/api/vitest.config.ts apps/api/tests/unit/authControllerAuditObservability.test.ts`
- `npx tsx scripts/guards/check-write-audit-timeout-policy.ts`
- `npm run guard:claude-discipline:ci`

### B1 schema-rowtype pipeline slice

- `npm run schema:regenerate`
- `git diff --exit-code apps/api/src/db/types packages/shared/src/_scaffolds`
- `npm run guard:generator-no-diff`
- `npm run guard:row-iface-drift`
- `npm run guard:code-columns`
- `npm run guard:query-builder-columns`
- `npm run guard:claude-discipline:ci`

### V1 runtime-honesty probes slice

- `npx eslint scripts/k6/baseline.js scripts/k6/load.js scripts/k6/stress.js scripts/k6/spike.js scripts/k6/soak.js scripts/k6/lib/patient.js e2e/fixtures/global-setup.ts scripts/guards/check-k6-thresholds.ts scripts/guards/check-dr-drill-asserts-fingerprint.ts scripts/guards/check-playwright-globalsetup-fail-closed.ts scripts/guards/__tests__/check-k6-thresholds.test.ts scripts/guards/__tests__/check-dr-drill-asserts-fingerprint.test.ts scripts/guards/__tests__/check-playwright-globalsetup-fail-closed.test.ts`
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-k6-thresholds.test.ts scripts/guards/__tests__/check-dr-drill-asserts-fingerprint.test.ts scripts/guards/__tests__/check-playwright-globalsetup-fail-closed.test.ts`
- `npm run guard:k6-thresholds`
- `npm run guard:dr-drill-fingerprint`
- `npm run guard:playwright-globalsetup-fail-closed`
- `npm run guard:claude-discipline:ci`
- `npm run dr:restore-drill` (pending dedicated DB + expected schema fingerprint baseline)
- `npm run perf:baseline` (pending running API target with seeded patient data)

### V2 canonical test substrate slice (seed singleton foundation)

- `npx eslint apps/api/tests/fixtures/canonical-personas.ts apps/api/tests/integration/_helpers.ts scripts/guards/check-canonical-persona-seed-singleton.ts scripts/guards/__tests__/check-canonical-persona-seed-singleton.test.ts`
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-canonical-persona-seed-singleton.test.ts`
- `npm run guard:canonical-persona-seed-singleton`
- `npm run seed:canonical-personas`
- `npm run guard:claude-discipline:ci`

### V2 contract drift triage slice (400-vs-422)

- `npx eslint apps/api/tests/integration/patientCrud.test.ts apps/api/tests/integration/episodeStateMachine.test.ts apps/api/tests/integration/bug395ChatContextLock.int.test.ts apps/api/tests/integration/bug336HiServiceVerify.int.test.ts apps/api/tests/integration/medicationConstraints.test.ts scripts/guards/check-no-ambiguous-validation-status.ts scripts/guards/__tests__/check-no-ambiguous-validation-status.test.ts`
- `npx vitest run --config vitest.config.ts scripts/guards/__tests__/check-no-ambiguous-validation-status.test.ts`
- `npm run guard:no-ambiguous-validation-status`
- `npm run guard:claude-discipline:ci`

### V2 validation-adapter normalization tranche 1 (`validateBody` parity)

- `npx tsc --noEmit -p apps/api/tsconfig.json`
- `npx eslint apps/api/src/middleware/validationMiddleware.ts apps/api/tests/unit/validationMiddleware.test.ts apps/api/tests/integration/bug336HiServiceVerify.int.test.ts`
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/validationMiddleware.test.ts`
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/bug336HiServiceVerify.int.test.ts`
- `npm run guard:no-ambiguous-validation-status`
- `npm run guard:claude-discipline:ci`

### BUG-466 B1 tranche 1 (`PatientDetailLayout` explicit-any drain)

- `npx eslint apps/web/src/features/patients/components/detail/PatientDetailLayout.tsx`
- `npx tsc --noEmit -p apps/web/tsconfig.json`
- file-level count probe on `@typescript-eslint/no-explicit-any` for `PatientDetailLayout.tsx` (expect `0`)
- `npm run guard:no-explicit-any-regression`
- `npm run guard:claude-discipline:ci`

### Runtime defect pair slice (duplicate patient + medication 500)

- `npx eslint apps/api/src/features/patients/duplicateDetection.ts apps/api/src/shared/authGuards.ts apps/api/tests/integration/medicationConstraints.test.ts`
- `cd apps/api && npx vitest run --config vitest.config.ts tests/unit/duplicateDetection.test.ts`
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/patientCrud.test.ts tests/integration/medicationConstraints.test.ts`

### C1 flake containment slice (`BUG-713`)

- `npm run probe:integration-reruns -- --file tests/integration/bugEpisodeMdtSaveRace.int.test.ts --runs 10 --max-fail-rate 0.01 --out /tmp/bug-713-rerun-summary-2026-05-09.json --log-dir /tmp/bug-713-reruns-2026-05-09`
- `npm run test:integration -w apps/api` (same-session confirmation including `bugEpisodeMdtSaveRace.int.test.ts`)
- `npm run guard:claude-discipline:ci`

### C2 canonical logger guard correction slice (`BUG-268`)

- `npx vitest run --config ./vitest.config.ts scripts/qa-agent/__tests__/level-1-static.pattern-logger.test.ts`
- `COMMIT_BODY=$'Change-Class: standard\n' npx tsx scripts/qa-agent/level-1-static.ts --files scripts/qa-agent/level-1-static.ts,apps/api/src/middleware/errorHandler.ts`
- `npm run test:guards`
- `npm run typecheck`
- `npm run guard:claude-discipline:ci`

### C2 multi-browser storage-state fidelity slice (`BUG-265`)

- `npx playwright install firefox webkit`
- `npx playwright test --project=firefox e2e/probes/storage-state-smoke.spec.ts --reporter=line`
- `npx playwright test --project=webkit e2e/probes/storage-state-smoke.spec.ts --reporter=line`
- `npx playwright test --project=mobile-iphone e2e/probes/storage-state-smoke.spec.ts --reporter=line`

### B5 save-workflow probe hardening slice (`BUG-712`)

- `npx playwright test --project=chromium --reporter=line e2e/probes/save-round-trip.spec.ts e2e/probes/double-submit.spec.ts`
- `npx playwright test --project=chromium --reporter=line e2e/02-patients.spec.ts`
- `npx eslint e2e/probes/save-round-trip.spec.ts e2e/probes/double-submit.spec.ts`
- `npm run guard:claude-discipline:ci`

## Required Mindset For Future Slices

### If a slice touches only docs or helpers

- `0a`, `L1`, `L3` are usually enough
- do not inflate to `L4`/`L5` unless runtime behavior changes

### If a slice touches backend runtime behavior

- `0a`, `L1`, `L2`, `L3`, `L4` are required
- `L5` required only when user-visible flow changes

### If a slice touches frontend route or UI truthfulness

- `0a`, `L1`, `L2`, `L3`, `L5` are required
- `L4` required if API contract also changed

### If a slice touches schema or triggers

- `0a`, `L1`, `L2`, `L4` are required
- use migration up/down, real DB proof, and schema diff proof
- run `npm run migrate:rehearsal` (ephemeral DB `latest -> rollback(all) -> latest`)

## Claim Wording Rules

Allowed:

- "targeted slice verification passed"
- "workspace-local checks passed"
- "helper/test slice is locally green"

Not allowed:

- "all checks passed"
- "the repo is green"
- "the program is verified"

unless the corresponding repo-wide commands actually passed in this run.
