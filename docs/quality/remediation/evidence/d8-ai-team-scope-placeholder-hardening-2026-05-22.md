# D8 AI Team-Scope Placeholder Hardening Slice (AI Agent + MCP)

**Date:** 2026-05-22  
**Scope:** Eliminate placeholder/generic team-token drift in AI tool dispatch and close stale route-contract ledger drift.

## 1) Problem Closed in This Slice

### A. Placeholder team tokens leaking into team-scoped tool calls
- Risk class: AI prompt/tool drift where generic tokens such as `team name`, `team`, or `caseload` can produce invalid tool arguments.
- Hardening applied:
  - `apps/api/src/mcp/server/aiScopeEnforcement.ts`
    - team placeholder normalization/recognition added.
    - team-scoped calls now treat placeholder/missing team as invalid and auto-fallback to scoped team label/id when available.
    - fail-closed error if no valid team context exists.
  - `apps/api/src/mcp/server/aiAgent.ts`
    - early reject for bracket-placeholder prompt text (for example `[team name]`, `[staff name]`, `[patient name]`) before tool dispatch.
    - fallback helper text updated to concrete examples (no placeholder tokens).

### B. Regression coverage for the exact failure class
- `apps/api/tests/integration/bug741AiAgentTeamScopeAndTenantContext.int.test.ts`
  - Added test: placeholder query string is rejected safely before tool dispatch.
  - Added test: placeholder team argument in team-scoped mode is normalized to the scoped team and returns caseload safely.

## 2) Verification (Local)

### L1
- `npm run -w apps/api build` ✅
- `npm run -w apps/web build` ✅
- `npm run typecheck` ✅
- `npm run lint` ✅

### L2
- `npm run -w apps/api test:integration -- bug741AiAgentTeamScopeAndTenantContext.int.test.ts` ✅ (`9/9`)

### L4
- `npm run guard:frontend-route-contract` ✅
- `npm run guard:no-fire-and-forget` ✅
- `npm run guard:claude-discipline` ✅

## 3) Ledger Sync (Stale-Item Removal)

- `docs/quality/bugs-remaining.md`
  - `BUG-SA-002` moved `open -> in_progress` with current implementation status and closure criteria.
  - `BUG-SA-005` moved `open -> in_progress` after route-contract guard confirmation with explicit staging closure criteria.

## 4) Residuals (Explicit)

1. Staging/canary proof is still required before bug-state flip to `fixed`.
2. This slice does not modify broader AI UX composition or long-form assistant workflows; those remain in subsequent AI enhancement slices.
