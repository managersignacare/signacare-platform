// apps/api/migrations/20260424000001_force_revoke_sessions_on_staff_state_change.ts
//
// BUG-353 Layer B — DB trigger that force-revokes staff_sessions rows
// whenever a security-relevant column on the staff row changes (role,
// is_active, deleted_at, clinic_id). Mirror of BUG-354's
// `clinics_access_admin_slot_integrity` trigger (migration 20260423000007)
// for the staff→sessions relationship.
//
// Why: Layer A lives in staffService.updateStaff (BUG-356 wiring —
// blacklistAllUserTokens + revokeSessionsForStaff on role/is_active
// changes). It does NOT cover:
//   - deleted_at transitions — updateStaff DTO has no deletedAt field;
//     soft-delete happens through code paths outside this service or
//     via direct SQL.
//   - clinic_id transfers — extremely rare, no app-layer UI, but a
//     manual SQL UPDATE to re-parent a staff row would leak.
//   - Direct SQL UPDATEs by operators during maintenance.
//
// Layer B closes the gap by enforcing the invariant at the DB level.
// AFTER UPDATE + FOR EACH ROW — the UPDATE completes first (so NEW.*
// reflects the committed state) then cascade the revocation.
//
// Audit: INSERT INTO audit_log with
// action='SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER' (distinct from
// Layer A's 'SESSION_REVOKED_BY_STATE_CHANGE' so forensic review can
// tell app-layer vs DB-layer revocation origin). new_data JSONB
// carries {trigger, sessions_revoked, old/new state snapshots}.
//
// SECURITY DEFINER so row-owning role isn't required to have
// audit_log INSERT privilege. EXCEPTION WHEN OTHERS swallows audit
// failure so the session-revoke UPDATE is never blocked (mirrors
// audit_trigger_fn pattern at baseline.ts:115-117).
//
// Satisfies CI guard check-trigger-has-audit-row.sh (BUG-358
// invariant): function body contains INSERT INTO audit_log.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION force_revoke_sessions_on_staff_state_change()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $fn$
    DECLARE
      v_trigger TEXT;
      v_changed BOOLEAN;
      v_revoked_count INT;
    BEGIN
      v_changed := FALSE;
      v_trigger := NULL;

      IF NEW.role IS DISTINCT FROM OLD.role THEN
        v_changed := TRUE;
        v_trigger := 'role_changed';
      ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        v_changed := TRUE;
        v_trigger := 'active_changed';
      ELSIF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
        v_changed := TRUE;
        v_trigger := 'soft_deleted';
      ELSIF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN
        v_changed := TRUE;
        v_trigger := 'clinic_transferred';
      END IF;

      IF v_changed THEN
        UPDATE staff_sessions
           SET revoked_at = NOW()
         WHERE staff_id = NEW.id
           AND revoked_at IS NULL;
        GET DIAGNOSTICS v_revoked_count = ROW_COUNT;

        BEGIN
          INSERT INTO audit_log (
            id, clinic_id, user_id, action, table_name, record_id,
            new_data, created_at
          )
          VALUES (
            gen_random_uuid(),
            NEW.clinic_id,
            COALESCE(NULLIF(current_setting('app.user_id', true), '')::uuid, NULL),
            'SESSION_REVOKED_BY_STATE_CHANGE_TRIGGER',
            'staff',
            NEW.id,
            jsonb_build_object(
              'trigger', v_trigger,
              'sessions_revoked', v_revoked_count,
              'old_role', OLD.role,
              'new_role', NEW.role,
              'old_is_active', OLD.is_active,
              'new_is_active', NEW.is_active,
              'old_clinic_id', OLD.clinic_id,
              'new_clinic_id', NEW.clinic_id,
              'soft_deleted', (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
            ),
            NOW()
          );
        EXCEPTION WHEN OTHERS THEN
          -- Audit failure must never block revocation. Mirrors
          -- audit_trigger_fn EXCEPTION at baseline.ts:115-117.
          NULL;
        END;
      END IF;

      RETURN NEW;
    END;
    $fn$;
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    DROP TRIGGER IF EXISTS force_revoke_sessions_after_staff_state_change ON staff;
    CREATE TRIGGER force_revoke_sessions_after_staff_state_change
    AFTER UPDATE OF role, is_active, deleted_at, clinic_id ON staff
    FOR EACH ROW
    EXECUTE FUNCTION force_revoke_sessions_on_staff_state_change();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`
    DROP TRIGGER IF EXISTS force_revoke_sessions_after_staff_state_change ON staff;
  `);
  // @migration-raw-exempt: function_drop
  await knex.raw(`
    DROP FUNCTION IF EXISTS force_revoke_sessions_on_staff_state_change();
  `);
}
