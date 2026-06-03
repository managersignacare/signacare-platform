# D3 Enterprise Single-Source Assessment (Architecture + Systematic Tests)

**Date:** 2026-05-19  
**Mode:** Consolidated evidence (single source of truth)  
**Purpose:** Merge deep architecture findings + systematic L1–L5 execution into one canonical document.

---

## 1) Executive Verdict

The repo now has strong guard depth and broad structural checks, but it is **not yet in full green enterprise gate state** because:

1. `guard:all` still fails on three commands.
2. Critical structural mismatches remain in dashboard/reallocation/route-contract areas.
3. Guard documentation and observed guard behavior were misaligned and have now been clarified (no proven route-catalog functional blind spot).

---

## 2) What Was Run (Consolidated)

### A) Systematic L1–L5 campaign (executed)

- **L1** Build/type/lint baseline
  - `npm run -w apps/api build` ✅
  - `npm run -w apps/web build` ✅
  - `npm run typecheck` ✅
  - `npm run lint` ✅

- **L2** High-risk integration packs
  - `bug741AiAgentTeamScopeAndTenantContext.int.test.ts` ✅
  - `bugBulkPlannedReallocationAssignmentPath.int.test.ts` ✅
  - `dashboardClinicalAlertsCycle2.int.test.ts` ✅
  - `dashboardManagerBillingKpis.int.test.ts` ✅

- **L3** Web logic tests
  - `dashboardRoleViews.test.ts` ✅
  - `staffAssignmentsPageSupport.test.ts` ✅
  - `staffDirectoryViewModel.test.ts` ✅

- **L4** Guard slices
  - Operational role SSoT / mutation invalidation / trx discipline / response-shape / clinic-scope / frontend fail-open guards ✅
  - Full `guard:all` executed (current fail details in Section 4).

- **L5** Architectural probes
  - Dashboard invalidation prefix mismatch ✅ confirmed
  - Dashboard role/data contract mismatch ✅ confirmed
  - Assignment-path blind spot (`episodes` vs `patient_team_assignments`) ✅ confirmed

### B) Mechanical guard pack status (repo-wide)

- `npm run guard:all` executed end-to-end.
- Result: **failed** with 3 failing guard commands (Section 4).

---

## 3) Structural Drift Matrix (Confirmed)

| ID | Area | Confirmed Pattern | Evidence Surface | Risk |
|---|---|---|---|---|
| C1 | Dashboard RBAC/data contract | Frontend role views can require endpoints blocked for certain valid roles | `dashboardRoleViews.ts`, `dashboardRoutes.ts`, `DashboardPage.tsx` | Empty/zero cards for valid users |
| C2 | Dashboard invalidation | Invalidation key `['dash-']` does not structurally match per-card keys like `['dash-caseload']` | `queryKeys.ts`, `DashboardPage.tsx` | Stale cards after auto-refresh |
| C3 | Reassign/transition writes | Multi-table updates executed without single transaction envelope | `staffSettingsRoutes.ts` | Partial commits / drift |
| C4 | Target integrity checks | Inconsistent clinic-bound validation for reassignment target entities | `staffSettingsRoutes.ts`, `reallocationService.ts` | Cross-scope mutation risk |
| C5 | Allocation source split | Some flows infer assignment from `patient_team_assignments`; others from `episodes` | `PatientsPage.tsx`, `patientRoutes.ts`, dashboard/caseload routes | “No open episodes found” despite active clinical state |
| H1 | Caseload semantic split | Manager reports and clinician dashboards use different assignment semantics | `managerFeatureRoutes.ts`, `caseManagerFeatureRoutes.ts` | Count/report disagreement |
| H2 | Governance inconsistency | `adminWrite` exists but bulk/transition paths still use broader admin gating | `staffSettingsRoutes.ts` | Policy drift |
| H3 | Parallel allocation engines | Separate reassignment and reallocation workflows with different invariants | `staffSettingsRoutes.ts`, `reallocationService.ts` | Rule duplication + drift |
| H4 | Role taxonomy drift | Canonical role schemas diverge from runtime literals in some paths | shared schemas + role groups + dashboard hooks | Authorization/view inconsistency |
| H5 | AI tool/prompt drift | Tool-context assumptions and prompt placeholders can mismatch runtime reality | AI agent UI + MCP routes | Wrong counts/errors in AI responses |
| M1 | Assignment patch granularity | Some mutation paths can affect multiple rows by patient scope | patient assignment update path | Over-update risk |
| M2 | Dashboard cache scope | Query keys not uniformly clinic-scoped | dashboard key factory | Cross-context cache risk |
| M3 | Transition list query shape | N+1 assignment counting pattern | transitions list route | Scale/latency risk |

---

## 4) Current `guard:all` Blocking Failures (As of 2026-05-19)

### 4.1 `guard:file-size`

- `apps/api/src/features/patients/patientRoutes.ts` above ceiling
- `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx` above ceiling
- `apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx` above ceiling
- `apps/web/src/features/patients/pages/PatientsPage.tsx` above ceiling
- `apps/api/src/mcp/server/mcpServer.ts` above architectural block threshold

### 4.2 `guard:frontend-route-contract`

- frontend routes detected without backend match:
  - `PATCH staff-settings/ai-context/${id}`
  - `DELETE staff-settings/ai-context/${id}`

### 4.3 `guard:frontend-urls`

- same two route-contract failures repeated by the companion check.

---

## 5) Guard Coverage Clarification (Updated)

### Route cataloging hypothesis — corrected status

- Initial hypothesis: frontend route-contract checks might miss non-`*Routes.ts` registrar handlers.
- Follow-up mechanical verification indicates the current implementation catalogs broadly across API `.ts` files and correctly caught real frontend phantom calls.
- Remaining issue is **documentation drift** in guard comments, not a proven route-catalog functional blind spot.

**Implication:** keep the route-contract guard, but align guard documentation to implementation to avoid future audit misreads.

---

## 6) Cross-Layer Contract Assessment

### API route registration
- Broad coverage exists, including registrar-based route definition files; the current issue is documentation alignment, not route catalog functional coverage.

### Shared schemas and runtime usage
- Major schema parity guard coverage is in place and passing (`zod-schema-parity`, response-shape guard), but role and envelope consistency still has drift pockets.

### Frontend query/data shape
- Key-factory pattern is strong; invalidation and cache-scope conventions need normalization per clinic context and per namespace.

### Tenant and RBAC gating
- Many protections are present and verified, but policy tiers are uneven between adjacent mutation surfaces.

---

## 7) Regression-Proof Strategy (Ongoing, Non-Looping)

### Phase R1 — Contract and policy freeze
1. Unify dashboard role-to-endpoint contract and enforce with role-matrix tests.
2. Normalize dashboard invalidation strategy (prefix-safe or explicit key list).
3. Implement the frozen single caseload truth model defined in D4 Section 2A across dashboards/reports/reallocation.

### Phase R2 — Mutation atomicity and integrity
1. Wrap bulk reassignment and transition execute/update flows in single transactions.
2. Enforce clinic-scoped existence checks for every target actor/team ID.
3. Add transactional rollback integration tests for partial failure scenarios.

### Phase R3 — Allocation architecture convergence
1. Harmonize reassignment and reallocation engines behind a shared domain contract.
2. Enforce one governance tier model for equivalent risk operations.
3. Add invariants to detect `episodes` vs `patient_team_assignments` drift.

### Phase R4 — Guard hardening
1. Align backend route-catalog guard documentation with the current registrar-aware implementation and add a regression check for catalog source coverage.
2. Add explicit guard for caseload semantic consistency across dashboard/report/reassign.
3. Keep L1–L5 evidence reruns mandatory after each remediation phase.

---

## 8) Enterprise Exit Criteria

A “gold standard” closure should require all below:

1. `guard:all` green with zero blocking failures.
2. Dashboard counts, AI agent totals, and reallocation dialogs derive from consistent allocation semantics.
3. No cross-clinic leakage in any assignment/caseload/reallocation path under role-matrix tests.
4. Multi-write mutation flows are transaction-safe and rollback-tested.
5. Route-contract guards account for both `*Routes.ts` and registrar-based route registration.
6. Guard documentation is aligned with guard implementation behavior to prevent future audit misreads.

---

## 9) Source Evidence

- [d1-enterprise-architecture-deep-dive-2026-05-19.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/d1-enterprise-architecture-deep-dive-2026-05-19.md)
- [d2-systematic-test-execution-2026-05-19.md](/Users/drprakashkamath/Projects/Signacare/docs/quality/remediation/evidence/d2-systematic-test-execution-2026-05-19.md)
