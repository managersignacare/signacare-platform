# D1 Enterprise Architecture Deep Dive (Exploration-Only)

**Date:** 2026-05-19  
**Mode:** Exploration-only (no fixes applied in this pass)  
**Scope:** Full-repo architectural risk walk-through with focus on RBAC, data-shape consistency, dashboard/reallocation behavior, AI assistant tool routing, and cross-clinic isolation boundaries.

## 1) What This Pass Did

This pass intentionally did **not** patch code.  
It consolidated hard evidence so remediation can proceed in one disciplined sequence rather than issue-by-issue loop work.

Evidence types used:
- Route and service line-level inspection (API + Web + shared types)
- Query key and cache invalidation contract inspection
- Reallocation/assignment workflow transaction-boundary review
- Role taxonomy consistency scan (canonical vs runtime literals)
- Response envelope shape scan (`res.json` shape drift)
- Integration/unit coverage spot-check for high-risk flows
- Build health checks (`apps/api` and `apps/web`)

## 2) Current Health Snapshot

- `npm run -w apps/api build` -> **pass**
- `npm run -w apps/web build` -> **pass**
- This removes one earlier concern that API build was failing due compile debt.

## 3) Critical Findings (Fix First)

### C1. Dashboard RBAC and dashboard data contract are still misaligned
- **Evidence:**
  - Clinician dashboard API route only allows `clinician/admin/superadmin`: `apps/api/src/features/dashboard/dashboardRoutes.ts:16`
  - Dashboard page always invokes clinician metrics hook: `apps/web/src/features/dashboard/pages/DashboardPage.tsx:154`
  - Manager hook role detection still includes legacy role literals not in canonical role enum: `apps/web/src/features/dashboard/hooks/useDashboardMetrics.ts:17`
- **Impact:** valid users can see zeroed cards or degraded dashboard state due endpoint gating mismatch and role-literal drift.

### C2. Dashboard auto-refresh invalidation does not match query key namespace design
- **Evidence:**
  - Per-card keys are `['dash-caseload']`, `['dash-my-clinic']`, etc.: `apps/web/src/features/dashboard/queryKeys.ts:27-39`
  - Auto refresh invalidates with `['dash-']`: `apps/web/src/features/dashboard/queryKeys.ts:43`, `apps/web/src/features/dashboard/pages/DashboardPage.tsx:142`
- **Impact:** intended refresh fan-out can silently miss targeted card queries depending on key-match semantics.

### C3. Bulk reassign and planned transitions are not transaction-safe end-to-end
- **Evidence:**
  - Bulk reassign updates `episodes` and `patient_team_assignments` in separate writes, no transaction: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:775-803`
  - Transition patch delete+reinsert assignment set without transaction: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:919-933`
  - Transition execute loops with independent per-row updates and final plan status update outside a transaction envelope: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:951-989`
- **Impact:** partial commit risk (episodes moved, assignments not moved, or plan status inconsistent).

### C4. Target clinician/team integrity validation gaps in reassignment paths
- **Evidence:**
  - `bulk-reassign` accepts `fromId/toId/fromTeam/toTeam` and applies updates without explicit clinic-bound existence checks: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:767-803`
  - Transition creation persists `from_staff_id` / `to_staff_id` from payload without explicit pre-validation in handler: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:875-899`
  - Reallocation service validates target team but not explicit target clinician membership before insert: `apps/api/src/features/reallocations/reallocationService.ts:150-157`, `:195`
- **Impact:** malformed payloads can trigger cross-clinic/cross-team integrity issues if upstream constraints are bypassed.

### C5. Reallocation dialog “No open episodes” symptom is structural, not just UI copy
- **Evidence:**
  - Bulk dialog source list is derived from `/patients/team-assignments` rows: `apps/web/src/features/patients/pages/PatientsPage.tsx:142-145`, `:183-211`
  - Empty-state message is shown when that assignment-derived list is empty: `apps/web/src/features/patients/pages/PatientsPage.tsx:417-421`
  - API for `/patients/team-assignments` merges assignment + open-episode fallback data, but still depends on assignment row availability/path quality: `apps/api/src/features/patients/patientRoutes.ts:292-355`
- **Impact:** patients may be visible elsewhere as open episodes but unavailable in bulk/planned workflows due assignment-path drift.

## 4) High Findings

### H1. Caseload semantics diverge across dashboard, manager reports, and mutation paths
- **Evidence:**
  - Dashboard/case-manager caseload uses multi-path assignment predicate: `apps/api/src/features/roles/caseManagerFeatureRoutes.ts:66-113`
  - Manager staff caseload only counts `episodes.primary_clinician_id`: `apps/api/src/features/roles/managerFeatureRoutes.ts:132-137`
  - Bulk/transition mutations update both episode and assignment rails: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:775-803`, `:951-979`
- **Impact:** counts/reporting drift and trust erosion between screens.

### H2. Assignment-governance policy is inconsistent
- **Evidence:**
  - `adminWrite` (nominated/delegated clinic authority) exists and protects team/role assignment writes: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:93-104`, `:120-128`
  - Bulk reassign + transitions use broader `admin` only: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:764`, `:817`, `:872`, `:907`, `:940`, `:994`
- **Impact:** sensitive mutation surfaces are not aligned to the stricter governance model already established in same module.

### H3. Two parallel allocation engines with different invariants
- **Evidence:**
  - Staff-settings rail (`bulk-reassign`, `transitions`): `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:763-999`
  - Reallocation approval rail (`patient_team_reallocations` state machine): `apps/api/src/features/reallocations/reallocationService.ts:133-396`
- **Impact:** policy drift, duplicated business rules, and inconsistent audit/approval semantics.

### H4. Role taxonomy drift between canonical shared enum and runtime route logic
- **Evidence:**
  - Canonical shared enum: `packages/shared/src/rbac.schemas.ts:4-12`
  - Runtime role groups include literals absent from canonical enum (`nurse`, `case_manager`, `psychiatrist`, `psychologist`): `apps/api/src/shared/roleGroups.ts:8-11`
  - Web manager-role detection includes legacy aliases (`clinicManager`, `clinicSuperUser`, `superAdmin`): `apps/web/src/features/dashboard/hooks/useDashboardMetrics.ts:17`
- **Impact:** authorization drift, fragile role checks, and inconsistent UI behavior.

### H5. AI prompt/template and tool-contract drift still exists
- **Evidence:**
  - Quick prompts still include placeholders (`[team name]`): `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:1078`
  - Agent system prompt still advertises `get_patient_context {"patientId","clinicId"}` while MCP side removed reliance on `a.clinicId`: `apps/api/src/mcp/server/aiAgent.ts:262`, `apps/api/src/mcp/server/mcpServer.ts:420-423`
- **Impact:** avoidable tool-call errors and brittle behavior in real user prompts.

## 5) Medium Findings

### M1. PATCH team assignment endpoint updates by `patient_id` (multi-row blast risk)
- **Evidence:** `apps/api/src/features/patients/patientRoutes.ts:362-378`
- **Impact:** one patch can unintentionally mutate multiple assignment rows for same patient.

### M2. Dashboard query keys are not clinic-scoped
- **Evidence:** dashboard keys use role/filter only; no clinic discriminator: `apps/web/src/features/dashboard/queryKeys.ts:17-43`
- **Impact:** cache bleed risk under clinic switching/session context transitions.

### M3. Planned transition list has N+1 assignment counting
- **Evidence:** per-transition count query in loop: `apps/api/src/features/staff-settings/staffSettingsRoutes.ts:836-840`
- **Impact:** avoidable latency/load amplification with larger transition sets.

### M4. Response-shape inconsistency across API is systemic
- **Evidence:**
  - Wrapper counts from quick scan:
    - `res.json({ data: ... })` -> 42
    - `res.json({ items: ... })` -> 24
    - `res.json({ entries: ... })` -> 2
    - `res.json({ ok: ... })` -> 91
    - non-object `res.json(result|rows|payload)` -> 282
  - Examples:
    - Data wrapper: `apps/api/src/features/reports/reportsRoutes.ts:56`
    - Items wrapper: `apps/api/src/features/referrals/referralRoutes.ts:172`
    - Raw payload: `apps/api/src/features/correspondence/correspondenceController.ts:30-47`
- **Impact:** frontend parser sprawl, contract fragility, and regression probability.

### M5. Coverage exists for core reassignment and AI team placeholder path, but not full risk matrix
- **Evidence:**
  - Reassignment regression pack: `apps/api/tests/integration/bugBulkPlannedReallocationAssignmentPath.int.test.ts`
  - AI team placeholder + tenant context test: `apps/api/tests/integration/bug741AiAgentTeamScopeAndTenantContext.int.test.ts`
  - Limited evidence of dedicated tests for full dashboard role-matrix contract and cache invalidation behavior.
- **Impact:** high-risk flows have some protection, but not comprehensive policy/contract verification.

## 6) Repo-Wide Architectural Risk Themes

1. **Policy Drift:** same domain has multiple auth/governance levels depending on endpoint, not action criticality.
2. **Contract Drift:** envelope shapes and role literals vary between shared types, API, and web.
3. **State Drift:** duplicated allocation engines and partial-write paths can diverge data truth.
4. **Observability Gaps:** user-facing zero states often mask route/contract mismatch rather than true zero data.
5. **Cache Isolation Risk:** many query keys are feature-scoped but not clinic-context scoped.

## 7) Regression-Proof Guard Blueprint (L1-L5)

### L1: Schema and contract SSOT
- Introduce normalized response envelope policy for list/detail/action endpoints.
- Enforce role enum SSOT and disallow non-canonical literals at compile/test time.

### L2: Transaction boundaries and invariant checks
- Require transaction wrapper for all multi-table mutation workflows (bulk/transition/reallocation).
- Add mandatory clinic-bound existence checks for all actor/team IDs in write payloads.

### L3: Authorization consistency
- Define action-tiered policy matrix and enforce one middleware profile per mutation class.
- Add route-level tests for governance parity (admin vs adminWrite vs delegated authority).

### L4: Cache and query-key safety
- Clinic-scope key factories where context switch is possible.
- Verify invalidation prefix behavior via dedicated unit tests for each key namespace.

### L5: End-to-end behavior packs
- Dashboard role-matrix + data-contract e2e pack.
- Reallocation/bulk/transition atomicity and rollback simulation tests.
- AI prompt-to-tool conformance tests (placeholder handling, tool argument schema conformance, tenant isolation).

## 8) Execution Sequencing Recommendation (No Fixes Applied Yet)

1. **Policy/contract freeze:** role taxonomy + response envelope decisions.
2. **Mutation safety:** transaction + validation hardening for allocation/reallocation.
3. **Dashboard parity:** RBAC alignment + caseload semantic convergence + key invalidation correctness.
4. **AI contract cleanup:** prompt-template and tool-argument alignment.
5. **Guard rollout:** L1-L5 tests and lint/CI gates to prevent drift recurrence.

---

## Appendix: Primary Files Reviewed

- `apps/api/src/features/dashboard/dashboardRoutes.ts`
- `apps/api/src/features/dashboard/dashboardController.ts`
- `apps/api/src/features/dashboard/dashboardService.ts`
- `apps/api/src/features/dashboard/dashboardRepository.ts`
- `apps/web/src/features/dashboard/pages/DashboardPage.tsx`
- `apps/web/src/features/dashboard/queryKeys.ts`
- `apps/web/src/features/dashboard/hooks/useDashboardMetrics.ts`
- `apps/api/src/features/staff-settings/staffSettingsRoutes.ts`
- `apps/api/src/features/reallocations/reallocationService.ts`
- `apps/api/src/features/patients/patientRoutes.ts`
- `apps/web/src/features/patients/pages/PatientsPage.tsx`
- `apps/api/src/features/roles/caseManagerFeatureRoutes.ts`
- `apps/api/src/features/roles/managerFeatureRoutes.ts`
- `apps/api/src/mcp/server/mcpServer.ts`
- `apps/api/src/mcp/server/aiAgent.ts`
- `apps/web/src/features/ai-agent/pages/AiAgentPage.tsx`
- `packages/shared/src/rbac.schemas.ts`
- `apps/api/src/shared/roleGroups.ts`
- `apps/api/tests/integration/bugBulkPlannedReallocationAssignmentPath.int.test.ts`
- `apps/api/tests/integration/bug741AiAgentTeamScopeAndTenantContext.int.test.ts`
