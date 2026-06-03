# A4c BUG-325 Local Evidence — Drop Dead `llm_interactions` updated_at Trigger

**Date:** 2026-05-14  
**Lane:** A4c (Platform Hygiene + LLM Runtime Governance)  
**BUG:** `BUG-325`  
**Scope:** local implementation only (no canary/burn-in claim in this file).

## What Landed

1. Added migration `apps/api/migrations/20260701000068_bug_325_drop_dead_llm_interactions_updated_at_trigger.ts`.
   - `up`: drops `trg_llm_interactions_updated_at` from `llm_interactions`.
   - `down`: restores `trg_llm_interactions_updated_at` (`BEFORE UPDATE` → `set_updated_at()`).

2. Dead-code rationale captured in implementation:
   - BUG-286 already enforces append-only semantics on `llm_interactions` via:
     - `llm_interactions_no_update` / `llm_interactions_no_delete` trigger-layer raises,
     - revoked `UPDATE/DELETE/TRUNCATE` privileges for `app_user`.
   - Therefore `trg_llm_interactions_updated_at` is unreachable and operationally misleading.

3. Regression proof was extended:
   - `apps/api/tests/integration/llmInteractionsImmutability.int.test.ts`
   - New test `T7` asserts `trg_llm_interactions_updated_at` is absent in `pg_trigger` for `public.llm_interactions`.

## Regression Proof (Local)

1. `npm run test:integration -w apps/api -- tests/integration/llmInteractionsImmutability.int.test.ts` => PASS (`7/7`)
2. `npm run lint:changed` => PASS
3. `npm run typecheck` => PASS
4. `npm run guard:all` => PASS

## Post-Deploy Closure Items (Still Required)

1. Replay migration rehearsal evidence in staging/prod-like environment (up/down posture + schema fingerprint).
2. Canary + burn-in verification that no llm_interactions mutation paths regress and no trigger-related schema drift appears.
3. Post-burn-in rerun evidence linked before catalogue flip.
