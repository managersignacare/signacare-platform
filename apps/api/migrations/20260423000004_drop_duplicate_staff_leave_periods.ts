// apps/api/migrations/20260423000004_drop_duplicate_staff_leave_periods.ts
//
// G3.C.2 redesign — migration 20260423000003 introduced two new tables
// (staff_leave_periods + reassignment_proposals) without verifying that
// an equivalent table already existed. An existing `staff_leave` table
// (richer shape — includes cover_staff_id, status, requested_by,
// approved_by_staff_id, approved_at) plus CRUD endpoints in
// managerFeatureRoutes.ts covers the leave-tracking concern.
//
// Gold-standard correction: drop the duplicate. The reassignment_
// proposals concept remains valid and will land in a future wave with
// its FK pointing at staff_leave(id) instead.
//
// Why forward-fix (not revert of the previous migration): the previous
// commit has shipped and the per-commit-never-amend discipline
// (feedback_wave_gate_discipline.md) forbids rewriting history.
// Dropping via a new, explicit migration is the reversible path.
//
// No data is at risk — both tables were minutes old when this correction
// was identified, and neither had any callers in production (the routes
// that would have exercised them were never merged).

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop proposals first — FK to staff_leave_periods would prevent
  // dropping the parent otherwise. CASCADE on the FK does the right
  // thing, but explicit-over-implicit per CLAUDE.md §4 architectural
  // standard.
  await knex.schema.dropTableIfExists('reassignment_proposals');
  await knex.schema.dropTableIfExists('staff_leave_periods');
}

export async function down(knex: Knex): Promise<void> {
  // Re-create the tables exactly as migration 20260423000003 left them
  // so rolling back this correction restores the prior state.
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
