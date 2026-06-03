# B4 — BUG-585-FOLLOWUP-MULTI-TIER-CASCADE Evidence (2026-05-13)

## Scope
- BUG: `BUG-585-FOLLOWUP-MULTI-TIER-CASCADE`
- Lane: `B4 — Scheduler + Alert Reliability`
- Objective: implement tier-3/tier-4 cascade after tier-2 with dedicated dedupe namespaces, thresholds, and recipient resolvers on both MHA and pathology scheduler surfaces.

## Structural Changes
- `apps/api/src/jobs/schedulers/mhaReviewScheduler.ts`
  - Added multi-tier escalation contract (`tier=2/3/4`) with:
    - tier-specific dedupe namespaces:
      - `mha-review-escalation:*`
      - `mha-review-governance-escalation:*`
      - `mha-review-regulatory-escalation:*`
    - tier-specific recipient resolver path:
      - tier-2: active team-leads + clinic admin
      - tier-3: active manager/admin + clinic admin
      - tier-4: active superadmin + clinic admin
    - tier-specific thresholds (minutes) via settings:
      - `mha_review_escalation_minutes` (existing tier-2)
      - `mha_review_escalation_tier3_minutes`
      - `mha_review_escalation_tier4_minutes`
  - Added helper exports:
    - `dedupeKeyForMhaEscalationTier(...)`
- `apps/api/src/jobs/schedulers/pathologyCriticalScheduler.ts`
  - Added parallel multi-tier escalation contract (`tier=2/3/4`) with:
    - tier-specific dedupe namespaces:
      - `pathology-critical-escalation:*`
      - `pathology-critical-governance-escalation:*`
      - `pathology-critical-regulatory-escalation:*`
    - tier-specific recipient resolver path:
      - tier-2: active team-leads + clinic admin
      - tier-3: active manager/admin + clinic admin
      - tier-4: active superadmin + clinic admin
    - tier-specific thresholds (minutes) via settings:
      - `pathology_escalation_minutes` (existing tier-2)
      - `pathology_escalation_tier3_minutes`
      - `pathology_escalation_tier4_minutes`
  - Added helper exports:
    - `dedupeKeyForPathologyEscalationTier(...)`
- `apps/api/src/features/settings/settingsService.ts`
  - Added default threshold keys:
    - `mha_review_escalation_tier3_minutes: 120`
    - `mha_review_escalation_tier4_minutes: 240`
    - `pathology_escalation_tier3_minutes: 240`
    - `pathology_escalation_tier4_minutes: 480`

## Regression Tests Added/Updated
- `apps/api/tests/unit/mhaReviewScheduler.test.ts`
  - Added tier-namespace helper proof (`TP-MHA-19c`)
  - Added multi-tier cascade integration proofs (`TP-MHA-40`, `TP-MHA-41`)
- `apps/api/tests/unit/pathologyCriticalScheduler.test.ts`
  - Added tier-namespace helper proof (`TP-PA-14b`)
  - Added multi-tier cascade integration proofs (`TP-PA-32`, `TP-PA-33`)

## Verification Executed
- `npm run test -w apps/api -- tests/unit/mhaReviewScheduler.test.ts tests/unit/pathologyCriticalScheduler.test.ts` => PASS (94/94)
- `npm run test:integration -w apps/api -- tests/integration/mhaReviewSchedulerCycle2.int.test.ts tests/integration/pathologyCriticalAlertsCycle2.int.test.ts` => PASS (10/10 + 9/9)
- `npm run typecheck` => PASS
- `npm run lint -w apps/api` => PASS
- `npm run guard:claude-discipline:ci` => PASS

## Status
- Implementation landed (local lane work complete).
- Rollout closure pending canary + burn-in + post-burn-in verification.
