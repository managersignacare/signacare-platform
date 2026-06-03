import type { Knex } from 'knex';

/**
 * Phase 0.7.5 c24 D10a — SD49 fix: add the `episode_types` lookup table.
 *
 * staffSettingsRoutes.ts (lines 461-470) exposes a CRUD surface for
 * "episode types" that operators use to classify clinical episodes
 * (e.g. 'community', 'inpatient', 'crisis_response', 'discharge_planning').
 * The route handlers INSERT/UPDATE/DELETE against an `episode_types`
 * table. That table did NOT exist — every admin CRUD operation silently
 * failed with "relation does not exist".
 *
 * Shape mirrors the sister admin-settings tables (appointment_modes,
 * template_categories, legal_order_type_configs): per-clinic lookup
 * with name, is_active, sort_order.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('episode_types');
  if (exists) return;

  await knex.schema.createTable('episode_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id']);
  });

  // Partial index on active rows for the list endpoint hot path
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_episode_types_clinic_active_sort
      ON episode_types (clinic_id, sort_order, name) WHERE is_active = true;
  `);

  // Duplicate-prevention — one episode type name per clinic (case-insensitive)
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS unq_episode_types_clinic_name_lower
      ON episode_types (clinic_id, LOWER(name));
  `);

  // RLS — CLAUDE.md §6.3 tenant isolation (not covered by builder)
  await knex.raw(`
    ALTER TABLE episode_types ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_episode_types_tenant ON episode_types;
    CREATE POLICY rls_episode_types_tenant ON episode_types
      FOR ALL
      USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
      WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);

  // Auto-update updated_at trigger, matching the rest of the
  // admin-settings lookup tables (same set_updated_at function)
  await knex.raw(`
    CREATE TRIGGER trg_episode_types_updated_at
      BEFORE UPDATE ON episode_types
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_episode_types_updated_at ON episode_types;
    DROP POLICY IF EXISTS rls_episode_types_tenant ON episode_types;
  `);
  await knex.schema.dropTableIfExists('episode_types');
}
