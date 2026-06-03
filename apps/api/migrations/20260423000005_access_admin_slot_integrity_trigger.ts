// apps/api/migrations/20260423000005_access_admin_slot_integrity_trigger.ts
//
// BUG-354 (S2 — blocked_by [BUG-351, BUG-352]) — DB cascade trigger for
// access-admin slot integrity. Layer B (belt-and-braces) paired with
// Layer A in authGuards.ts (BUG-351 R-FIX-BUG-351-ACCESS-ADMIN-STAFF-JOIN).
//
// Pre-fix: if a staff member who is the nominated_admin or delegated_admin
// of a clinic is demoted, deactivated, soft-deleted, OR transferred to a
// different clinic, their FK on `clinics` dangles. The app-layer guard
// catches this at query time (BUG-351), but the DB-layer slot stays stale
// indefinitely — a future reactivation / role re-elevation silently
// re-grants the bypass. Admins auditing `clinics.*admin_staff_id` see an
// FK that points at a no-longer-eligible staff row.
//
// Fix: BEFORE UPDATE trigger on `staff` — when ANY of
//   role ∈ ('receptionist','readonly')  (demotion to operational-only)
//   is_active = false                   (deactivation)
//   deleted_at IS NOT NULL              (soft-delete)
//   clinic_id changed                   (transfer — BUG-352 concern)
// fires, NULL every matching nominated_admin_staff_id /
// delegated_admin_staff_id on `clinics`. Admins must explicitly re-nominate.
//
// Operational-role list ('receptionist','readonly') is duplicated here
// from packages/shared/src/permissions.ts. If that list changes, this
// trigger must be updated in a new migration. The shared/permissions.ts
// export OPERATIONAL_ONLY is SSoT for the app layer; this SQL literal
// is SSoT for the DB layer. Drift risk is low (operational-role set
// changes are rare) but flagged in the bug catalogue as BUG-355
// (operational-role SSoT between TS + SQL).

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
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

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER staff_access_admin_slot_integrity
      AFTER UPDATE OF role, is_active, deleted_at, clinic_id ON staff
      FOR EACH ROW
      EXECUTE FUNCTION clinics_access_admin_slot_integrity();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`DROP TRIGGER IF EXISTS staff_access_admin_slot_integrity ON staff`);
  // @migration-raw-exempt: function_drop
  await knex.raw(`DROP FUNCTION IF EXISTS clinics_access_admin_slot_integrity()`);
}
