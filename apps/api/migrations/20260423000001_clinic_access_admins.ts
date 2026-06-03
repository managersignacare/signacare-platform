// apps/api/migrations/20260423000001_clinic_access_admins.ts
//
// Phase 0.5.A — per-clinic nominated + delegated access administrators.
//
// Foundation for the three-layer access model introduced in PART 12 of
// plans/sleepy-roaming-meteor.md:
//
//   1. Superadmin — cross-clinic settings operator. NO clinical-data
//      access. Manages Power Settings including which staff are the
//      nominated/delegated admin per clinic.
//   2. Nominated admin + Delegated admin (per clinic) — two staff per
//      subscribing organisation who have full clinical + settings +
//      access-control authority within their clinic.
//   3. Everyone else — access via team / role / episode / appointment
//      relationships; operational roles (receptionist / readonly) get
//      no clinical access.
//
// This migration adds two nullable FK columns to `clinics` + the
// CHECK constraint that prevents the same staff appearing in both
// slots. Columns stay NULL post-migration (deliberate strict
// transition, per clarification #3 on the plan). Until a superadmin
// populates the pair via the new Power Settings tab, only superadmin
// can change access settings for that clinic — no other admin gets
// ambient authority. This forces every subscribing org to go through
// the explicit nomination step.
//
// FK ON DELETE SET NULL — if the nominated or delegated staff record
// is deleted, the slot clears (rather than cascading a clinic
// deletion). A superadmin is expected to re-nominate before ambient
// authority re-activates.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinics', (t) => {
    t.uuid('nominated_admin_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('delegated_admin_staff_id').references('id').inTable('staff').onDelete('SET NULL');
    t.index(['nominated_admin_staff_id'], 'idx_clinics_nominated_admin');
    t.index(['delegated_admin_staff_id'], 'idx_clinics_delegated_admin');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinics
      ADD CONSTRAINT clinics_access_admin_distinct
      CHECK (nominated_admin_staff_id IS NULL
             OR delegated_admin_staff_id IS NULL
             OR nominated_admin_staff_id <> delegated_admin_staff_id)
  `);

  // L3-absorb-1: cross-clinic containment. Layer-B defence: the nominated
  // or delegated admin MUST be a staff member of THIS clinic. Without
  // this trigger, a superadmin (or buggy service call) could nominate
  // Clinic B's staff as Clinic A's admin and thereby grant them clinical
  // + settings access to Clinic A's data. Layer-A Zod validation lands
  // in 0.5.C; this trigger is the defence-in-depth fallback.
  // @migration-raw-exempt: function_create
  await knex.raw(`
    CREATE OR REPLACE FUNCTION clinics_access_admin_same_clinic_check() RETURNS trigger AS $$
    BEGIN
      IF NEW.nominated_admin_staff_id IS NOT NULL THEN
        PERFORM 1 FROM staff
          WHERE id = NEW.nominated_admin_staff_id AND clinic_id = NEW.id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'nominated_admin_staff_id must reference a staff member of this clinic (Phase 0.5.A cross-clinic containment)'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      IF NEW.delegated_admin_staff_id IS NOT NULL THEN
        PERFORM 1 FROM staff
          WHERE id = NEW.delegated_admin_staff_id AND clinic_id = NEW.id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'delegated_admin_staff_id must reference a staff member of this clinic (Phase 0.5.A cross-clinic containment)'
            USING ERRCODE = '23514';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER clinics_access_admin_same_clinic_before_insert
      BEFORE INSERT ON clinics
      FOR EACH ROW EXECUTE FUNCTION clinics_access_admin_same_clinic_check()
  `);
  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER clinics_access_admin_same_clinic_before_update
      BEFORE UPDATE OF nominated_admin_staff_id, delegated_admin_staff_id ON clinics
      FOR EACH ROW EXECUTE FUNCTION clinics_access_admin_same_clinic_check()
  `);

  // Preflight audit — log clinic count so ops know how many still
  // need nomination. NULL-pair clinics are in strict-transition mode
  // (only superadmin can change access settings).
  // @migration-raw-exempt: introspection
  const result = await knex.raw<{ rows: Array<{ count: string }> }>(`
    SELECT COUNT(*)::text AS count FROM clinics
    WHERE nominated_admin_staff_id IS NULL AND delegated_admin_staff_id IS NULL
  `);
  const pendingCount = result.rows?.[0]?.count ?? '0';
  // eslint-disable-next-line no-console
  console.log(
    `[Phase 0.5.A preflight] clinics awaiting nominated-admin + delegated-admin assignment: ${pendingCount}. ` +
    `Superadmin must populate via Power Settings > Access Administrators before non-superadmin admins regain access-settings write capability.`,
  );
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clinics_access_admin_same_clinic_before_update ON clinics');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS clinics_access_admin_same_clinic_before_insert ON clinics');
  // @migration-raw-exempt: function_drop
  await knex.raw('DROP FUNCTION IF EXISTS clinics_access_admin_same_clinic_check()');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_access_admin_distinct');
  await knex.schema.alterTable('clinics', (t) => {
    t.dropIndex(['delegated_admin_staff_id'], 'idx_clinics_delegated_admin');
    t.dropIndex(['nominated_admin_staff_id'], 'idx_clinics_nominated_admin');
    t.dropColumn('delegated_admin_staff_id');
    t.dropColumn('nominated_admin_staff_id');
  });
}
