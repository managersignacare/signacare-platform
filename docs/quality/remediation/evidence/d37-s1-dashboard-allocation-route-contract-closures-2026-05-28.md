# D37 — S1 Closures: Dashboard + Allocation + Route Contract

**Date:** 2026-05-28  
**Bugs closed in this evidence pack:**  
- `BUG-SA-001` (Dashboard / RBAC)  
- `BUG-SA-002` (Dashboard / Cache)  
- `BUG-SA-003` (Reallocation / Data Integrity)  
- `BUG-SA-005` (Route Contracts)

## What Was Completed

1. Re-ran the high-risk allocation/reallocation integration suite:
   - `bugBulkPlannedReallocationAssignmentPath.int.test.ts` (**PASS**)
2. Re-ran dashboard API integration suites:
   - `dashboardClinicalAlertsCycle2.int.test.ts` (**PASS**)
   - `dashboardManagerBillingKpis.int.test.ts` (**PASS**)
3. Re-ran dashboard web logic suites:
   - `dashboardRoleViews.test.ts` (**PASS**)
   - `dashboardPageSupport.test.ts` (**PASS**)
4. Re-ran route-contract guards:
   - `guard:frontend-route-contract` (**PASS**)
   - `guard:frontend-urls` (**PASS**)

## Structural Hardening Applied During Verification

Two dashboard integration suites were failing under FORCE-RLS due to test seeding without tenant context.  
Fixed by migrating seed writes/cleanup in:

- `apps/api/tests/integration/dashboardClinicalAlertsCycle2.int.test.ts`
- `apps/api/tests/integration/dashboardManagerBillingKpis.int.test.ts`

to explicit clinic-scoped transaction context (`set_config('app.clinic_id', ...)`) so pass/fail reflects real route behavior instead of setup leakage.

## Outcome

These four S1 bugs are closed with green integration + web logic + contract guards and tenant-safe test harness execution.

