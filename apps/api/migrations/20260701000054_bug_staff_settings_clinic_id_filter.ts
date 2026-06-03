/*
 * BUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) — Group 2 structural fix
 *
 * Add `clinic_id uuid NOT NULL` + FK to `clinics(id) ON DELETE CASCADE`
 * + index + RLS policy (`rls_<table>_tenant`) to:
 *   - staff_team_assignments
 *   - staff_role_assignments
 *
 * Pre-fix state (Group 2 per BUG row 2026-05-06): these 2 tables had
 * NO `clinic_id` column AND NO RLS policy, relying entirely on
 * app-layer filtering — which was missing on 4 UPDATE/DELETE sites in
 * staffSettingsRepository.ts. Cross-tenant write authorization gap
 * with NO mitigation (sibling lookup tables in the same module all
 * carry clinic_id + RLS).
 *
 * Post-fix state: both tables match the canonical pattern of sibling
 * tables (professional_disciplines, clinical_roles, referral_sources,
 * investigation_types) — clinic_id NOT NULL + RLS belt + app-layer
 * `.where({ id, clinic_id: clinicId })` first-line-of-defence per
 * CLAUDE.md §1.3 + §6.3 + §7.1 (New Table Checklist).
 *
 * Backfill: `clinic_id` derived from `staff.clinic_id` via JOIN on
 * `staff_id`. The existing FK + NOT NULL constraint on staff_id
 * guarantees every row has a non-null staff reference; the staff row
 * has clinic_id NOT NULL per the staff table schema. So backfill is
 * lossless.
 *
 * Operator-authorized 2026-05-06 (option c — gold-standard structural
 * fix path; alternatives (a) JOIN-through-staff app-layer patch and
 * (b) split-fix were considered and rejected per BUG row revision).
 *
 * Companion app-layer fix lands in the same atomic commit (12 sites
 * in staffSettingsRepository.ts + 12 service callsites + 12 controller
 * callsites + 2 INSERT sites updated to write clinic_id).
 *
 * Builder-first per CLAUDE.md §12.1 + §12.4. Raw SQL only for
 * data backfill + RLS policy + idempotent guards (per taxonomy).
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Step 1: Add clinic_id NULLABLE first (pre-backfill state) + index.
  // Builder-first per §12.1. Index declared in same alterTable that
  // introduces the column per CLAUDE.md §7.1 + check-migration-index-discipline
  // guard convention (every clinic_id-bearing column declares its index in the
  // same alterTable). Postgres indexes nullable columns without issue; the
  // index is built once on the empty/nullable column and continues to cover
  // the post-backfill NOT NULL state.
  const teamHas = await knex.schema.hasColumn('staff_team_assignments', 'clinic_id');
  if (!teamHas) {
    await knex.schema.alterTable('staff_team_assignments', (t) => {
      t.uuid('clinic_id'); // nullable initially for backfill
      t.index(['clinic_id'], 'idx_staff_team_assignments_clinic_id');
    });
  }
  const roleHas = await knex.schema.hasColumn('staff_role_assignments', 'clinic_id');
  if (!roleHas) {
    await knex.schema.alterTable('staff_role_assignments', (t) => {
      t.uuid('clinic_id'); // nullable initially for backfill
      t.index(['clinic_id'], 'idx_staff_role_assignments_clinic_id');
    });
  }

  // Step 2: Backfill clinic_id from staff.clinic_id via JOIN on staff_id.
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE staff_team_assignments sta
       SET clinic_id = s.clinic_id
      FROM staff s
     WHERE sta.staff_id = s.id
       AND sta.clinic_id IS NULL
  `);

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE staff_role_assignments sra
       SET clinic_id = s.clinic_id
      FROM staff s
     WHERE sra.staff_id = s.id
       AND sra.clinic_id IS NULL
  `);

  // Step 3: Set NOT NULL (index already declared in Step 1).
  // Builder-first per §12.1.
  // @migration-index-exempt: clinic_id index declared in Step 1 alterTable above (idx_staff_team_assignments_clinic_id); cannot redeclare here without duplicate-index error
  await knex.schema.alterTable('staff_team_assignments', (t) => {
    t.uuid('clinic_id').notNullable().alter();
  });

  // @migration-index-exempt: clinic_id index declared in Step 1 alterTable above (idx_staff_role_assignments_clinic_id); cannot redeclare here without duplicate-index error
  await knex.schema.alterTable('staff_role_assignments', (t) => {
    t.uuid('clinic_id').notNullable().alter();
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'staff_team_assignments_clinic_id_foreign'
      ) THEN
        ALTER TABLE staff_team_assignments
          ADD CONSTRAINT staff_team_assignments_clinic_id_foreign
          FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'staff_role_assignments_clinic_id_foreign'
      ) THEN
        ALTER TABLE staff_role_assignments
          ADD CONSTRAINT staff_role_assignments_clinic_id_foreign
          FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  // Step 4: Add RLS policies (CLAUDE.md §6.3).
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE staff_team_assignments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_staff_team_assignments_tenant ON staff_team_assignments;
    CREATE POLICY rls_staff_team_assignments_tenant ON staff_team_assignments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE staff_role_assignments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_staff_role_assignments_tenant ON staff_role_assignments;
    CREATE POLICY rls_staff_role_assignments_tenant ON staff_role_assignments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Reverse order: drop RLS, drop FK + index, drop column.

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw(`DROP POLICY IF EXISTS rls_staff_team_assignments_tenant ON staff_team_assignments`);
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw(`DROP POLICY IF EXISTS rls_staff_role_assignments_tenant ON staff_role_assignments`);

  await knex.schema.alterTable('staff_team_assignments', (t) => {
    t.dropForeign(['clinic_id']);
    t.dropIndex(['clinic_id'], 'idx_staff_team_assignments_clinic_id');
    t.dropColumn('clinic_id');
  });

  await knex.schema.alterTable('staff_role_assignments', (t) => {
    t.dropForeign(['clinic_id']);
    t.dropIndex(['clinic_id'], 'idx_staff_role_assignments_clinic_id');
    t.dropColumn('clinic_id');
  });
}
