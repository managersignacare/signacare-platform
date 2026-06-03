# D43 Structural Stale-Drain Closure — SA-104 / SA-106 / FIX-REGISTRY-ORPHAN

**Date:** 2026-05-28  
**Scope:** Close remaining stale/superseded structural rows that now have enforceable controls and passing guard proof.

## Closed Items

### 1) `BUG-SA-104` — Eventing Architecture

Closed as fixed because mutation fan-out convergence is now machine-enforced:
- `guard:centralized-notification-emitter` (prevents direct emitter bypass)
- `guard:notification-event-convergence-contract` with canonical targets in
  `.github/notification-event-convergence-contract.json`

This satisfies the SA-104 requirement (“one notification architecture for key lifecycle transitions”).

### 2) `BUG-SA-106` — Dashboard Contexting

Closed as fixed with explicit clinic-scope isolation enforcement:
- Dashboard query key SSoT already uses clinic scope token across key factories:
  - `apps/web/src/features/dashboard/queryKeys.ts`
- New regression guard added:
  - `scripts/guards/check-dashboard-query-key-clinic-scope.ts`
  - npm script: `guard:dashboard-query-key-clinic-scope`
  - wired into `guard:claude-discipline`

The guard blocks regression to flat legacy keys and enforces clinic-tokenized key factories.

### 3) `BUG-FIX-REGISTRY-ORPHAN-DRAIN` — Guard Hygiene

Closed as fixed after proving historical orphan entries are no longer orphaned:
- `BACKUP4` anchor points to existing file:
  - `apps/api/src/jobs/schedulers/backupScheduler.ts`
- `BLOB9` anchor points to existing file:
  - `apps/api/src/features/power-settings/powerSettingsRoutes.ts`
- `bash .github/scripts/check-fix-registry.sh` passes green with zero failures.

### 4) `BUG-SA-108` — Guard Documentation

Closed with targeted documentation/implementation alignment on route-guard
surfaces to prevent repeat audit misreads:
- Clarified controller-write-bypass guard scope comment to match actual scan
  patterns (`*Routes.ts`, `*.routes.ts`, `*Controller.ts`, `*.controller.ts`)
  in `scripts/guards/check-controller-repo-write-bypass.ts`.
- Confirmed route-contract guard already documents registrar-aware cataloging
  (`routes + registrar modules`) in
  `scripts/guards/check-frontend-calls-backend-route.ts`.
- Discipline guard chain is green after alignment (`guard:claude-discipline:ci`).

## Gate Evidence

- `npm run -s guard:dashboard-query-key-clinic-scope` ✅
- `npm run -s guard:claude-discipline:ci` ✅
- `bash .github/scripts/check-fix-registry.sh` ✅
- `npm run -s typecheck` ✅

## Note

This closure is intentionally narrow: it drains stale structural debt without
relabeling deployment-gated work that still requires production telemetry or
external dependencies.
