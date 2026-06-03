// apps/api/migrations/20260423000007_access_admin_trigger_audit_log.ts
//
// BUG-354 FORWARD-FIX — audit_log emission on the access-admin slot
// integrity trigger (shipped at commit 72ab65f, migration 20260423000005).
//
// Why: retroactive L4 BLOCK + L5 REJECT (2026-04-23) flagged the original
// trigger as silently mutating security-critical state (NULLing
// `clinics.{nominated,delegated}_admin_staff_id`) with zero audit trail.
// Violated HIPAA §164.312(b) (audit controls) + OWASP ASVS v4 §7.1.3
// (record security-relevant events).
//
// Fix: CREATE OR REPLACE FUNCTION clinics_access_admin_slot_integrity()
// — same function name, same trigger binding, body now emits one
// audit_log row per affected clinic BEFORE the slot UPDATE. Uses
// `SECURITY DEFINER` so the row-owning role isn't required to have
// audit_log INSERT privilege + EXCEPTION WHEN OTHERS swallows audit
// failure so the slot-clearing operation never breaks (mirrors the
// canonical `audit_trigger_fn` pattern from baseline.ts:96-120).
//
// Column usage in audit_log matches the existing schema-snapshot columns
// — every column referenced here is present in apps/api/src/db/
// schema-snapshot.json under "audit_log". `action` is a free-text
// column (no CHECK constraint — verified via SELECT DISTINCT on live DB).
//
// The ADMIN_SLOT_CLEARED_BY_TRIGGER action string is added to the
// AuditAction TS union at apps/api/src/utils/audit.ts in the same commit
// so app-layer log readers get typed support for the new action.
//
// The trigger itself (CREATE TRIGGER staff_access_admin_slot_integrity)
// does NOT need to be re-created — it binds to the function by name and
// CREATE OR REPLACE FUNCTION replaces the body in-place without breaking
// the binding.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION clinics_access_admin_slot_integrity()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      ineligible BOOLEAN;
      reason TEXT;
    BEGIN
      ineligible :=
        (NEW.role IN ('receptionist','readonly'))
        OR (NEW.is_active = false)
        OR (NEW.deleted_at IS NOT NULL)
        OR (NEW.clinic_id IS DISTINCT FROM OLD.clinic_id);

      IF ineligible THEN
        reason :=
          CASE
            WHEN NEW.role IN ('receptionist','readonly') THEN 'role_demoted'
            WHEN NEW.is_active = false THEN 'deactivated'
            WHEN NEW.deleted_at IS NOT NULL THEN 'soft_deleted'
            WHEN NEW.clinic_id IS DISTINCT FROM OLD.clinic_id THEN 'clinic_transferred'
            ELSE 'unknown'
          END;

        BEGIN
          -- Emit one audit_log row per clinic whose slot is about to
          -- be cleared. Runs BEFORE the UPDATE so the row lands even
          -- if the subsequent UPDATE fails (rollback scope is the
          -- outer transaction, so atomicity is preserved).
          INSERT INTO audit_log (
            id, clinic_id, user_id, action, table_name, record_id,
            new_data, created_at
          )
          SELECT
            gen_random_uuid(),
            c.id,
            COALESCE(NULLIF(current_setting('app.user_id', true), '')::uuid, NULL),
            'ADMIN_SLOT_CLEARED_BY_TRIGGER',
            'clinics',
            c.id,
            jsonb_build_object(
              'staff_id', NEW.id,
              'reason', reason,
              'slot', CASE
                WHEN c.nominated_admin_staff_id = NEW.id AND c.delegated_admin_staff_id = NEW.id THEN 'both'
                WHEN c.nominated_admin_staff_id = NEW.id THEN 'nominated'
                WHEN c.delegated_admin_staff_id = NEW.id THEN 'delegated'
                ELSE 'none'
              END
            ),
            now()
          FROM clinics c
          WHERE c.nominated_admin_staff_id = NEW.id
             OR c.delegated_admin_staff_id = NEW.id;
        EXCEPTION WHEN OTHERS THEN
          -- Audit write failure must never block the slot-clearing
          -- operation. Mirrors audit_trigger_fn at baseline.ts:115-117.
          NULL;
        END;

        UPDATE clinics
           SET nominated_admin_staff_id = NULL
         WHERE nominated_admin_staff_id = NEW.id;
        UPDATE clinics
           SET delegated_admin_staff_id = NULL
         WHERE delegated_admin_staff_id = NEW.id;
      END IF;

      RETURN NEW;
    END;
    $$;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Restore the pre-audit-log body (the shape shipped in migration
  // 20260423000005, commit 72ab65f) so rollback returns to the
  // documented BUG-354 Layer B state, not an earlier state.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION clinics_access_admin_slot_integrity()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      ineligible BOOLEAN;
    BEGIN
      ineligible :=
        (NEW.role IN ('receptionist','readonly'))
        OR (NEW.is_active = false)
        OR (NEW.deleted_at IS NOT NULL)
        OR (NEW.clinic_id IS DISTINCT FROM OLD.clinic_id);

      IF ineligible THEN
        UPDATE clinics
           SET nominated_admin_staff_id = NULL
         WHERE nominated_admin_staff_id = NEW.id;
        UPDATE clinics
           SET delegated_admin_staff_id = NULL
         WHERE delegated_admin_staff_id = NEW.id;
      END IF;

      RETURN NEW;
    END;
    $$;
  `);
}
