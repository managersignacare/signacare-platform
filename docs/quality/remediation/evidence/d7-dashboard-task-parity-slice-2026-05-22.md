# D7 Dashboard Task Parity Slice (Task + Dashboard Alignment)

**Date:** 2026-05-22  
**Mode:** Structural parity hardening + fail-visible dashboard behavior

## Scope

- Eliminate team-task count drift between task list and dashboard aggregates.
- Remove fail-open task/appt query behavior in My Dashboard where it could show false zeros.
- Ensure My Dashboard open-task KPI uses clinician dashboard SSoT count.

## Changes

1. Shared canonical team-task scope SQL
   - Added `apps/api/src/features/tasks/taskScopeSql.ts`.
   - Extracted team-task scope predicate used for:
     - assigned tasks (team membership via `staff_team_assignments` OR `staff_role_assignments`)
     - unassigned tasks (team ownership via `episodes.team_id` OR active `patient_team_assignments`)

2. Task list and dashboard now use same predicate
   - `apps/api/src/features/tasks/taskRepository.ts`
     - `findMany` now calls `applyTeamTaskScopeFilter(...)`.
   - `apps/api/src/features/dashboard/dashboardRepository.ts`
     - `countTeamOpenTasks` now calls `applyTeamTaskScopeFilter(...)`.
     - This removes divergent duplicated logic.

3. My Dashboard open-task KPI now reads backend SSoT
   - `apps/web/src/features/dashboard/pages/DashboardPage.tsx`
   - Open Tasks tile now uses `clinicianData.openTasks` as canonical count (fallback to local list rows only when needed).

4. Fail-visible behavior for My Dashboard list fetches
   - Removed silent catch fallbacks that returned `[]` for:
     - `myAppointments` query
     - `myTasks` query
   - Added their error flags into dashboard error state so UI can signal degraded metrics rather than false-zero.

## Gate Evidence

### L1
- `npm run -w apps/api build` ✅
- `npm run -w apps/web build` ✅
- `npm run typecheck` ✅
- `npm run lint` ✅

### L2
- `npm run -w apps/api test:integration -- dashboardTeamScope.int.test.ts` ✅
  - Includes parity assertion:
    - `/dashboard/team` `totals.openTasks` equals `/tasks?teamId=...` open-task count
    - `/dashboard/clinician` `openTasks` equals `/tasks?assignedToId=...` open-task count

### L3
- `cd apps/web && npx vitest run src/features/dashboard/pages/dashboardRoleViews.test.ts` ✅

### L4
- `npm run guard:claude-discipline` ✅

## Outcome

- Task-list and team-dashboard task counts now derive from one SQL scope predicate.
- My Dashboard no longer silently masks task/appointment query failures as zeros.
- Open Tasks KPI is anchored to backend clinician dashboard SSoT.

