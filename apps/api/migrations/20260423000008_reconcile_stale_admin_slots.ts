// apps/api/migrations/20260423000008_reconcile_stale_admin_slots.ts
//
// BUG-362 — one-off reconciliation sweep for stale admin slots.
//
// Context: BUG-354 (migration 20260423000005 + forward-fix 20260423000007)
// introduced `clinics_access_admin_slot_integrity` trigger that NULLs
// `clinics.{nominated,delegated}_admin_staff_id` when the referenced
// staff transitions to an ineligible state. The trigger only fires on
// NEW transitions. L4 clinical-safety retrospective on commit 80bc2ac
// flagged that any clinic whose FK currently points at a staff row
// where `is_active=false` OR `deleted_at IS NOT NULL` OR
// `role IN ('receptionist','readonly')` is a pre-existing stale-slot
// vulnerability the trigger will NOT self-heal. This one-off migration
// reconciles them.
//
// L5 absorb (Std 3 SSoT — 2026-04-24):
//   The ineligibility predicate was duplicated across the BUG-351
//   app-layer guard, the BUG-354 trigger body, and this migration's
//   3 SQL sites (5 copies total). This migration extracts a canonical
//   SQL helper `is_admin_slot_ineligible_staff(staff_id uuid) RETURNS
//   BOOLEAN LANGUAGE sql STABLE` and rewrites both the BUG-354 trigger
//   function AND this migration's 3 sites to call it. The TS-side
//   guard at authGuards.ts still duplicates the logic in a JS closure
//   (can't call SQL helpers from a non-DB control-flow path) but
//   that's a single source on the TS side — so we're down from 5
//   copies to 2 (SQL + TS). Full SSoT-via-DB-helper (have
//   authGuards.ts call this SQL function per request) would add a
//   Redis/PG roundtrip to every patient-access check — unacceptable
//   performance cost. Documented split-SSoT is the right tradeoff.
//
// L5 absorb (Std 5 reversibility — 2026-04-24):
//   down() now `throw new Error(...)` fails loud instead of silently
//   no-oping. Rolling back BUG-362 would re-create dangling FKs
//   pointing at ineligible staff (a worse state than the reconciled
//   one). If rollback is genuinely required, restore from
//   pre-migration snapshot. migrate:rollback will surface the error,
//   not phantom-succeed.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Canonical SQL helper — single source of truth for "is this staff
  // member ineligible to hold an access-admin slot?". Used by:
  //   (a) this migration's reconciliation sweep (3 call sites below),
  //   (b) the BUG-354 trigger function `clinics_access_admin_slot_
  //       integrity` (re-defined at the end of this migration's up()
  //       to use the helper).
  // The TS-side guard at apps/api/src/shared/authGuards.ts keeps its
  // own JS predicate (documented split-SSoT — calling a SQL function
  // per request would add a PG roundtrip to every access check).
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION is_admin_slot_ineligible_staff(target_staff_id UUID)
    RETURNS BOOLEAN
    LANGUAGE sql
    STABLE
    AS $$
      SELECT EXISTS (
        SELECT 1
        FROM staff s
        WHERE s.id = target_staff_id
          AND (
            s.role IN ('receptionist','readonly')
            OR s.is_active = false
            OR s.deleted_at IS NOT NULL
          )
      );
    $$
  `);

  // Emit one audit_log row per affected clinic BEFORE the slot UPDATE.
  // Shape matches the BUG-354 trigger's ADMIN_SLOT_CLEARED_BY_TRIGGER
  // row so forensic tooling can query on a union of both actions.
  // @migration-raw-exempt: data_backfill_insert
  await knex.raw(`
    INSERT INTO audit_log (
      id, clinic_id, user_id, action, table_name, record_id,
      new_data, created_at
    )
    SELECT
      gen_random_uuid(),
      c.id,
      NULL,
      'ADMIN_SLOT_CLEARED_RECONCILIATION',
      'clinics',
      c.id,
      jsonb_build_object(
        'staff_id', s.id,
        'reason',
          CASE
            WHEN s.role IN ('receptionist','readonly') THEN 'role_demoted'
            WHEN s.is_active = false THEN 'deactivated'
            WHEN s.deleted_at IS NOT NULL THEN 'soft_deleted'
            ELSE 'unknown'
          END,
        'slot',
          CASE
            WHEN c.nominated_admin_staff_id = s.id AND c.delegated_admin_staff_id = s.id THEN 'both'
            WHEN c.nominated_admin_staff_id = s.id THEN 'nominated'
            WHEN c.delegated_admin_staff_id = s.id THEN 'delegated'
            ELSE 'none'
          END
      ),
      now()
    FROM clinics c
    JOIN staff s ON s.id = c.nominated_admin_staff_id OR s.id = c.delegated_admin_staff_id
    WHERE is_admin_slot_ineligible_staff(s.id)
  `);

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE clinics c
       SET nominated_admin_staff_id = NULL
     WHERE c.nominated_admin_staff_id IS NOT NULL
       AND is_admin_slot_ineligible_staff(c.nominated_admin_staff_id)
  `);

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE clinics c
       SET delegated_admin_staff_id = NULL
     WHERE c.delegated_admin_staff_id IS NOT NULL
       AND is_admin_slot_ineligible_staff(c.delegated_admin_staff_id)
  `);

  // L5 absorb (Std 3): rewrite the BUG-354 trigger to use the helper.
  // Same function name (clinics_access_admin_slot_integrity) so the
  // trigger binding is preserved. New body is semantically identical
  // to the 20260423000007 version but calls the helper instead of
  // inlining the predicate.
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
        is_admin_slot_ineligible_staff(NEW.id)
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

export async function down(_knex: Knex): Promise<void> {
  // L5 absorb (Std 5): fail LOUD, not silent. Rolling back this
  // reconciliation would re-create dangling FKs pointing at ineligible
  // staff — a worse state than the reconciled one. If rollback is
  // genuinely required, restore from pre-migration DB snapshot.
  // migrate:rollback will surface this error instead of phantom-
  // succeeding on a silent no-op.
  throw new Error(
    'BUG-362 reconciliation is irreversible. Rolling back would re-create dangling ' +
    'clinics.{nominated,delegated}_admin_staff_id FKs pointing at ineligible staff ' +
    '(role in operational-only, is_active=false, or deleted_at NOT NULL). ' +
    'If rollback is genuinely required, restore from pre-migration DB snapshot. ' +
    'See docs/plans/bug-362-stale-admin-slot-reconciliation.md for rationale.',
  );
}
