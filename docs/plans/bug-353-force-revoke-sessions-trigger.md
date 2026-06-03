# Plan — BUG-353 Layer B DB trigger — force-revoke sessions on staff state change

## Context

BUG-353 was paused per PART 14 (sleepy-roaming-meteor plan) pending BUG-356. BUG-356 shipped in `e9dbd4d` — `authMiddleware` now calls `isUserRevokedAfter` (Redis blacklist) on every JWT verify, and `authService.refresh` checks `staff_sessions.revoked_at`. `staffService.updateStaff` writes BOTH at Layer A.

What's missing is **Layer B** — a DB trigger that fires `UPDATE staff_sessions SET revoked_at = NOW()` regardless of code path (direct SQL, ops maintenance, migration). Same defence-in-depth pattern as BUG-354 (`clinics_access_admin_slot_integrity`).

Layer A (staffService.updateStaff) currently covers `role` and `is_active` transitions. It does NOT cover `deleted_at` (soft-delete) or `clinic_id` (transfer) because those fields are not in the updateStaff DTO. Layer B closes that gap mechanically.

## Change surface

1. Migration `apps/api/migrations/20260424000001_force_revoke_sessions_on_staff_state_change.ts` — mirrors the BUG-354 forward-fix trigger shape. Function + trigger. Fires AFTER UPDATE OF (role, is_active, deleted_at, clinic_id) ON staff. Updates `staff_sessions.revoked_at` + emits `SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER` audit row. SECURITY DEFINER + EXCEPTION WHEN OTHERS.
2. `apps/api/src/utils/audit.ts` — add `SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER` to AuditAction union.
3. `apps/api/src/db/schema-snapshot.json` — regenerate.
4. New integration test `bug353ForceRevokeSessionsTrigger.int.test.ts` — T1 role change, T2 is_active=false, T3 deleted_at set, T4 benign column update (no revoke), T5 clinic_transferred, T6 audit row shape.

## Gate

L1 (tsc + 17 CI guards incl. check-trigger-has-audit-row) + L2 (TDD + adjacent + flake ×3) + L3 + L4 (clinical-safety — session mgmt) + L5 (db trigger).
