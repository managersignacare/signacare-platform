import type { Knex } from 'knex';

/**
 * Phase 13 PR1 — per-clinician calendar foundation.
 *
 * Ships two tables + a backfill:
 *
 *   clinician_availability_blocks
 *     Declarative traffic-light week. Each block is either a weekly
 *     recurring slot (day_of_week + recurrence='weekly') or a one-off
 *     override (specific_date + recurrence='none'). Colour ∈
 *     {red, yellow, green} maps to unavailable / tentative / free.
 *     CHECK constraint enforces that exactly one of day_of_week and
 *     specific_date is populated per row. RLS scoped to clinic_id.
 *
 *   appointment_attendees
 *     Junction table that lets a single appointment appear in every
 *     participating clinician's calendar via one indexed JOIN. For
 *     single-clinician appointments the junction holds one row with
 *     role='primary' + staff_id=appointments.clinician_id. For multi-
 *     clinician appointments additional rows with role='co_clinician'
 *     (or supervisor/observer/etc) reference the same appointment_id.
 *     Enforces UNIQUE (appointment_id, staff_id) so the same clinician
 *     cannot be double-added to a single session.
 *
 * The backfill writes a primary attendee row for every existing
 * non-deleted appointment in one INSERT SELECT, so all legacy single-
 * clinician appointments become visible via the new JOIN on the very
 * first read after this migration lands. ON CONFLICT DO NOTHING makes
 * it safe to re-run if the migration is partially applied.
 *
 * See CLAUDE.md §7 + §9.3 for the schema checklist this migration
 * follows (RLS, NOT NULL, indexes on clinic_id + patient_id, unique
 * constraints for business rules).
 */

export async function up(knex: Knex): Promise<void> {
  // ── 1. clinician_availability_blocks ───────────────────────────────
  if (!(await knex.schema.hasTable('clinician_availability_blocks'))) {
    await knex.schema.createTable('clinician_availability_blocks', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id')
        .notNullable()
        .references('id')
        .inTable('clinics')
        .onDelete('CASCADE');
      t.uuid('clinician_id')
        .notNullable()
        .references('id')
        .inTable('staff')
        .onDelete('CASCADE');
      t.string('colour', 10).notNullable();
      t.string('recurrence', 10).notNullable().defaultTo('weekly');
      t.smallint('day_of_week').nullable();
      t.date('specific_date').nullable();
      t.time('start_time').notNullable();
      t.time('end_time').notNullable();
      t.date('effective_from').notNullable().defaultTo(knex.fn.now());
      t.date('effective_until').nullable();
      t.string('label', 200).nullable();
      t.text('notes').nullable();
      t.uuid('created_by_staff_id')
        .nullable()
        .references('id')
        .inTable('staff')
        .onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
    });

    // CHECK constraints — colour enum, recurrence enum, day_of_week
    // range, end>start, and the weekly/none xor rule. Done via raw
    // SQL because Knex's column builder doesn't expose CHECK directly.
    await knex.raw(`
      ALTER TABLE clinician_availability_blocks
        ADD CONSTRAINT cab_colour_chk
          CHECK (colour IN ('red','yellow','green')),
        ADD CONSTRAINT cab_recurrence_chk
          CHECK (recurrence IN ('none','weekly')),
        ADD CONSTRAINT cab_day_of_week_chk
          CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
        ADD CONSTRAINT cab_time_range_chk
          CHECK (end_time > start_time),
        ADD CONSTRAINT cab_recurrence_shape_chk
          CHECK (
            (recurrence = 'weekly' AND day_of_week IS NOT NULL AND specific_date IS NULL)
            OR
            (recurrence = 'none'   AND day_of_week IS NULL     AND specific_date IS NOT NULL)
          );
    `);

    await knex.schema.alterTable('clinician_availability_blocks', (t) => {
      t.index(['clinic_id', 'clinician_id', 'day_of_week'], 'cab_weekly_idx');
      t.index(
        ['clinic_id', 'clinician_id', 'specific_date'],
        'cab_oneoff_idx',
      );
      t.index(['deleted_at'], 'cab_deleted_at_idx');
    });

    // RLS per CLAUDE.md §6.3
    await knex.raw(`
      ALTER TABLE clinician_availability_blocks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_clinician_availability_blocks_tenant
        ON clinician_availability_blocks
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── 2. appointment_attendees ──────────────────────────────────────
  if (!(await knex.schema.hasTable('appointment_attendees'))) {
    await knex.schema.createTable('appointment_attendees', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id')
        .notNullable()
        .references('id')
        .inTable('clinics')
        .onDelete('CASCADE');
      t.uuid('appointment_id')
        .notNullable()
        .references('id')
        .inTable('appointments')
        .onDelete('CASCADE');
      t.uuid('staff_id')
        .notNullable()
        .references('id')
        .inTable('staff')
        .onDelete('CASCADE');
      t.string('role', 20).notNullable().defaultTo('co_clinician');
      t.string('attendance_status', 20).notNullable().defaultTo('required');
      t.timestamp('invited_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      t.timestamp('responded_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      t.unique(['appointment_id', 'staff_id'], {
        indexName: 'appointment_attendees_unique',
      });
      t.index(
        ['clinic_id', 'staff_id', 'appointment_id'],
        'appointment_attendees_my_calendar_idx',
      );
      t.index(['appointment_id'], 'appointment_attendees_appointment_idx');
    });

    await knex.raw(`
      ALTER TABLE appointment_attendees
        ADD CONSTRAINT aa_role_chk
          CHECK (role IN (
            'primary','co_clinician','supervisor','observer','interpreter','support'
          )),
        ADD CONSTRAINT aa_attendance_status_chk
          CHECK (attendance_status IN (
            'required','accepted','tentative','declined',
            'attended','did_not_attend','removed'
          ));
    `);

    await knex.raw(`
      ALTER TABLE appointment_attendees ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_appointment_attendees_tenant
        ON appointment_attendees
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);

    // Backfill: every existing non-deleted appointment gets a primary
    // attendee row mapped from its clinician_id. Uses INSERT SELECT
    // plus ON CONFLICT DO NOTHING so re-running the migration after a
    // partial apply is a no-op.
    await knex.raw(`
      INSERT INTO appointment_attendees (
        appointment_id, clinic_id, staff_id, role, attendance_status,
        invited_at, created_at, updated_at
      )
      SELECT
        id,
        clinic_id,
        clinician_id,
        'primary',
        CASE
          WHEN status IN ('completed','arrived','in_session') THEN 'attended'
          WHEN status = 'no_show'                             THEN 'did_not_attend'
          WHEN status = 'cancelled'                           THEN 'removed'
          ELSE 'required'
        END,
        COALESCE(created_at, now()),
        COALESCE(created_at, now()),
        COALESCE(updated_at, now())
      FROM appointments
      WHERE deleted_at IS NULL
        AND clinician_id IS NOT NULL
      ON CONFLICT (appointment_id, staff_id) DO NOTHING;
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'DROP POLICY IF EXISTS rls_appointment_attendees_tenant ON appointment_attendees;',
  );
  await knex.schema.dropTableIfExists('appointment_attendees');

  await knex.raw(
    'DROP POLICY IF EXISTS rls_clinician_availability_blocks_tenant ON clinician_availability_blocks;',
  );
  await knex.schema.dropTableIfExists('clinician_availability_blocks');
}
