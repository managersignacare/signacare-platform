// apps/api/migrations/20260423000003_staff_leave_periods.ts
//
// USER-C.2 / BUG-USER-ITEM-12 — consultant-on-leave forward / reassign
// workflow. Introduces two tables:
//
//   1. staff_leave_periods — first-class "staff on leave" record so a
//      consultant's unavailability is structured data (not an informal
//      Slack message). Open-ended end_date supports indefinite leave.
//
//   2. reassignment_proposals — auto-generated per-patient proposals
//      that pair a leave period with a covering clinician. Admin vets
//      each proposal (approve / reject) before the team assignment is
//      updated.
//
// RLS, CHECK constraints, and indexes on (clinic_id) + foreign-key
// columns per CLAUDE.md §1 + §7. Down path is symmetric and re-runnable.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── staff_leave_periods ─────────────────────────────────────────────
  await knex.schema.createTable('staff_leave_periods', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.date('start_date').notNullable();
    t.date('end_date');
    t.string('leave_type', 40).notNullable();
    t.text('notes');
    t.uuid('recorded_by_id').references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true });
    t.index(['clinic_id']);
    t.index(['staff_id']);
    t.index(['clinic_id', 'start_date', 'end_date'], 'idx_staff_leave_active_window');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE staff_leave_periods
      ADD CONSTRAINT staff_leave_dates_chronological
      CHECK (end_date IS NULL OR end_date >= start_date)
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE staff_leave_periods
      ADD CONSTRAINT staff_leave_type_check
      CHECK (leave_type IN ('annual','sick','study','parental','personal','other'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE staff_leave_periods ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_staff_leave_periods_tenant ON staff_leave_periods
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // ── reassignment_proposals ──────────────────────────────────────────
  await knex.schema.createTable('reassignment_proposals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('leave_period_id').notNullable().references('id').inTable('staff_leave_periods').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('from_staff_id').notNullable().references('id').inTable('staff');
    t.uuid('to_staff_id').notNullable().references('id').inTable('staff');
    t.string('proposal_status', 20).notNullable().defaultTo('pending');
    t.text('vetted_reason');
    t.uuid('vetted_by_id').references('id').inTable('staff');
    t.timestamp('vetted_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true });
    t.index(['clinic_id']);
    t.index(['leave_period_id']);
    t.index(['patient_id']);
    t.index(['proposal_status']);
    t.index(['clinic_id', 'proposal_status'], 'idx_reassignment_pending_queue');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE reassignment_proposals
      ADD CONSTRAINT reassignment_status_check
      CHECK (proposal_status IN ('pending','approved','rejected','expired'))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE reassignment_proposals
      ADD CONSTRAINT reassignment_distinct_staff_check
      CHECK (from_staff_id <> to_staff_id)
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE reassignment_proposals ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_reassignment_proposals_tenant ON reassignment_proposals
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_reassignment_proposals_tenant ON reassignment_proposals');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE reassignment_proposals DROP CONSTRAINT IF EXISTS reassignment_distinct_staff_check');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE reassignment_proposals DROP CONSTRAINT IF EXISTS reassignment_status_check');
  await knex.schema.dropTableIfExists('reassignment_proposals');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_staff_leave_periods_tenant ON staff_leave_periods');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE staff_leave_periods DROP CONSTRAINT IF EXISTS staff_leave_type_check');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE staff_leave_periods DROP CONSTRAINT IF EXISTS staff_leave_dates_chronological');
  await knex.schema.dropTableIfExists('staff_leave_periods');
}
