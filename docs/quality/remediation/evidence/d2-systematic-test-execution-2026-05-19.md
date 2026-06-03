# D2 Systematic Test Execution (L1–L5, Non-Looping)

**Date:** 2026-05-19  
**Mode:** Test execution + evidence (no code fixes in this pass)  
**Goal:** Run the deep-dive test matrix systematically and surface hard failures vs proven behavior.

## 1) Execution Matrix

### L1 — Build + type + lint baseline
- `npm run -w apps/api build` -> ✅ pass
- `npm run -w apps/web build` -> ✅ pass
- `npm run typecheck` -> ✅ pass
- `npm run lint` -> ✅ pass

### L2 — High-risk integration regression packs
- `npm run -w apps/api test:integration -- bug741AiAgentTeamScopeAndTenantContext.int.test.ts bugBulkPlannedReallocationAssignmentPath.int.test.ts dashboardClinicalAlertsCycle2.int.test.ts dashboardManagerBillingKpis.int.test.ts` -> ✅ pass
  - `bug741AiAgentTeamScopeAndTenantContext.int.test.ts` -> 3/3
  - `bugBulkPlannedReallocationAssignmentPath.int.test.ts` -> 4/4
  - `dashboardClinicalAlertsCycle2.int.test.ts` -> 5/5
  - `dashboardManagerBillingKpis.int.test.ts` -> 1/1

### L3 — Web logic tests for dashboard/staff assignment surfaces
- `npx vitest run --config vitest.config.ts src/features/dashboard/pages/dashboardRoleViews.test.ts src/features/staff-settings/pages/staffAssignmentsPageSupport.test.ts src/features/staff-settings/pages/staffDirectoryViewModel.test.ts` (run in `apps/web`) -> ✅ pass (13 tests)

### L4 — Guard suite slices (policy/contract/transaction/security)
- `npm run guard:operational-role-ssot` -> ✅ pass
- `npm run guard:mutation-invalidation` -> ✅ pass
- `npm run guard:trx-not-db-inside-transaction` -> ✅ pass
- `npm run guard:response-shape-validated` -> ✅ pass
- `npm run guard:query-has-clinic-id` -> ✅ pass
- `npm run guard:frontend-fail-open-gates` -> ✅ pass
- `npm run guard:all` -> ❌ fail (see Section 3)

### L5 — Focused architectural probes (live runtime behavior)
- React Query invalidation contract probe using `QueryClient`:
  - `invalidateQueries({ queryKey: ['dash-'] })` does **not** invalidate `['dash-my-clinic']` / `['dash-caseload']` -> ❌ confirmed mismatch.
- Dashboard role/endpoints access probe across canonical personas (`superadmin/admin/manager/clinician/receptionist/referral_coordinator/readonly`) -> mixed; see Section 2.
- Team-assignment source-path probe (patient with open episode but no `patient_team_assignments` row) -> endpoint returned zero assignments -> ❌ confirmed structural gap.

## 2) Confirmed Behavioral Defects

### A. Dashboard role-view/data contract mismatch (confirmed)
Role probe showed:
- `referral_coordinator` and `readonly` roles receive **403** on:
  - `/dashboard/clinician`
  - `/dashboard/caseload`
  - `/dashboard/my-clinic-today`
- Yet UI role mapping currently routes both to `my_dashboard`, which depends on these APIs.

Implication:
- Valid signed-in users can land on a dashboard view that cannot legally hydrate its core cards.

### B. Dashboard auto-refresh invalidation key mismatch (confirmed)
Observed with live `QueryClient` probe:
- Prefix invalidation key `['dash-']` does not match keys like `['dash-caseload']`.

Implication:
- Auto-refresh fan-out silently misses dashboard card queries.

### C. Bulk/planned source-list blind spot in patient reallocation flow (confirmed)
Probe:
- Created a patient with an **open episode** and clinician/team linkage in `episodes`.
- Did **not** create a `patient_team_assignments` row.
- `/patients/team-assignments` returned `assignmentsReturned: 0`.

Implication:
- Reassignment dialogs can show “No open episodes found” even when open episodes exist.

## 3) Current `guard:all` Failures

`npm run guard:all` failed with 3 failing guard commands:

1. `guard:file-size`
- `apps/api/src/features/patients/patientRoutes.ts` above ceiling
- `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx` above ceiling
- `apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx` above ceiling
- `apps/web/src/features/patients/pages/PatientsPage.tsx` above ceiling
- `apps/api/src/mcp/server/mcpServer.ts` above architectural block threshold

2. `guard:frontend-route-contract` / `guard:frontend-urls`
- Frontend calls with no backend handler:
  - `PATCH staff-settings/ai-context/${id}`
  - `DELETE staff-settings/ai-context/${id}`

## 4) Outcome

This pass successfully executed the requested systematic L1–L5 campaign and produced hard evidence without looping.  
The three confirmed runtime defects above remain active and are not yet remediated in this pass.

