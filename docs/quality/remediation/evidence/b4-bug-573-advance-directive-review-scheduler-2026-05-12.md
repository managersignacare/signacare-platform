# B4 — BUG-573 Advance-Directive Review Scheduler (2026-05-12)

## Scope

- Lane: `B4` (Scheduler and alert reliability framework)
- BUG: `BUG-573`
- Objective: add a deterministic, fail-visible scheduler for advance-directive review reminders.

## Implementation Summary

1. Added scheduler implementation:
   - `apps/api/src/jobs/schedulers/advanceDirectiveReviewScheduler.ts`
   - Daily cron (`07:10` Australia/Melbourne)
   - Bucket model: `T-30d`, `T-14d`, `T-7d`, `T-1d`, `T+overdue`
   - Deterministic dedupe by directive + recipient + bucket + UTC day
   - dbAdmin live query + emit path (`conn: dbAdmin`)
2. Added recipient fallback and immutable audit events:
   - `ADVANCE_DIRECTIVE_REVIEW_RECIPIENT_REASSIGNED`
   - `ADVANCE_DIRECTIVE_REVIEW_NO_RECIPIENT_AVAILABLE`
3. Registered scheduler in bootstrap:
   - `apps/api/src/jobs/bootstrap.ts`
4. Added coverage:
   - Unit: `apps/api/tests/unit/advanceDirectiveReviewScheduler.test.ts`
   - Integration: `apps/api/tests/integration/advanceDirectiveReviewScheduler.int.test.ts`

## Schema-Truth Correction

- BUG text referenced `advance_directives.review_date`.
- Current schema uses `advance_directives.valid_until` as the review-by axis.
- Scheduler uses `valid_until` as canonical source.

## Verification Commands

```bash
npm run lint:changed
npm run typecheck
npm run guard:claude-discipline:ci
cd apps/api && npx vitest run tests/unit/advanceDirectiveReviewScheduler.test.ts
cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/advanceDirectiveReviewScheduler.int.test.ts
```

## Results

- `npm run -s lint:changed` => PASS
- `npm run -s typecheck` => PASS
- `npm run -s guard:claude-discipline:ci` => PASS
- `cd apps/api && npx vitest run tests/unit/advanceDirectiveReviewScheduler.test.ts` => PASS (`12/12`)
- `cd apps/api && npx vitest run --config vitest.integration.config.ts tests/integration/advanceDirectiveReviewScheduler.int.test.ts` => PASS (`5/5`)

## Rollout Closure Note

- `BUG-573` remains open until canary + burn-in + post-burn-in evidence is attached per Section 17 closure contract.
