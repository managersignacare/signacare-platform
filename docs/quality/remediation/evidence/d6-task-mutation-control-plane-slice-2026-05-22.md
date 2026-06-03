# D6 Task Mutation Control-Plane Slice (Task Management)

**Date:** 2026-05-22  
**Mode:** Structural hardening + regression guard (pre-deployment)

## Scope

- Enforce a single orchestration path for all task write mutations.
- Remove scattered route-level task inserts for discharge and pathology flows.
- Add integration proof for in-clinic discharge-summary task creation.
- Add mechanical guard preventing mutation-path drift.

## Changes

1. Added new command module:
   - `apps/api/src/features/tasks/taskMutationCommand.ts`
   - Centralizes:
     - create: `executeTaskCreateMutation`
     - update: `executeTaskUpdateMutation`
     - delete: `executeTaskDeleteMutation`
   - Enforces clinic-bound existence checks for task actor/creator, assignee, patient, and episode.
   - Enforces patient/episode consistency when both are present.

2. Routed task service writes through command module:
   - `apps/api/src/features/tasks/taskService.ts`
   - `createTaskInternal`, `createTaskInternalAdmin`, `updateTask`, `deleteTask` now call command functions.

3. Hardened task repository write contract:
   - `apps/api/src/features/tasks/taskRepository.ts`
   - Allows explicit task type/status on create.
   - Update now stamps/clears `completed_at` + `completed_by_id` consistently by status transition.

4. Removed route-local task inserts (drift source):
   - `apps/api/src/features/episode/episodeRoutes.ts`
     - discharge/closure review task creation now uses `createTaskInternal`.
   - `apps/api/src/features/patients/patientRoutes.ts`
     - pathology review task creation now uses `createTaskInternal`.

5. Added regression guard:
   - `scripts/guards/check-task-mutation-command-convergence.ts`
   - Wired into:
     - `package.json` script `guard:task-mutation-command-convergence`
     - `guard:claude-discipline` chain
   - Guard asserts:
     - taskService imports/calls taskMutationCommand
     - taskService does not call mutating repo methods directly
     - no direct `db('tasks').insert/update/delete` outside explicit allowlist

6. Integration coverage uplift:
   - `apps/api/tests/integration/episodeDischargeSummaryClinicScope.int.test.ts`
   - Added positive test proving in-clinic submission creates `discharge_review` task with expected ownership and status.
   - Existing cross-tenant negative control preserved.

## Gate Evidence

### L1
- `npm run -w apps/api build` ✅
- `npm run typecheck` ✅
- `npm run lint` ✅

### L2
- `npm run -w apps/api test:integration -- episodeDischargeSummaryClinicScope.int.test.ts taskTeamScope.int.test.ts` ✅

### L4
- `npm run guard:task-mutation-command-convergence` ✅
- `npm run guard:no-fire-and-forget` ✅
- `npm run guard:claude-discipline` ✅

## Risk Notes

- No behavioral change intended for read paths.
- Existing unrelated mobile/patient-app workspace changes are out-of-scope for this slice and intentionally excluded.

