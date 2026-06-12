import type { Knex } from 'knex';

const SUBSCRIPTIONS_TABLE = 'external_calendar_subscriptions';
const APPOINTMENTS_TABLE = 'appointments';

export async function up(knex: Knex): Promise<void> {
  const hasChangeKey = await knex.schema.hasColumn(APPOINTMENTS_TABLE, 'outlook_change_key');
  if (!hasChangeKey) {
    await knex.schema.alterTable(APPOINTMENTS_TABLE, (t) => {
      t.string('outlook_change_key', 255).nullable();
      t.timestamp('outlook_last_synced_at', { useTz: true }).nullable();
      t.timestamp('outlook_last_modified_at', { useTz: true }).nullable();
      t.string('outlook_sync_status', 30).notNullable().defaultTo('not_synced');
      t.text('outlook_sync_error').nullable();
    });
  }

  if (!(await knex.schema.hasTable(SUBSCRIPTIONS_TABLE))) {
    await knex.schema.createTable(SUBSCRIPTIONS_TABLE, (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('owner_staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.string('provider', 30).notNullable();
      t.string('external_subscription_id', 255).notNullable();
      t.string('resource', 255).notNullable();
      t.text('notification_url').notNullable();
      t.text('lifecycle_notification_url').nullable();
      t.string('client_state', 255).notNullable();
      t.timestamp('expiration_utc', { useTz: true }).notNullable();
      t.string('status', 30).notNullable().defaultTo('active');
      t.timestamp('last_notification_at', { useTz: true }).nullable();
      t.timestamp('last_renewed_at', { useTz: true }).nullable();
      t.text('last_error').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id'], 'idx_external_calendar_subscriptions_clinic');
      t.index(['owner_staff_id'], 'idx_external_calendar_subscriptions_owner');
      t.index(['provider', 'external_subscription_id'], 'idx_external_calendar_subscriptions_provider_external');
      t.index(['expiration_utc'], 'idx_external_calendar_subscriptions_expiration');
    });

    // @migration-raw-exempt: index_partial
    await knex.raw(`
      CREATE UNIQUE INDEX uq_external_calendar_subscriptions_provider_owner_active
        ON ${SUBSCRIPTIONS_TABLE} (provider, owner_staff_id)
        WHERE deleted_at IS NULL;
    `);

    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE ${SUBSCRIPTIONS_TABLE}
        ADD CONSTRAINT external_calendar_subscriptions_provider_check
        CHECK (provider IN ('outlook'));

      ALTER TABLE ${SUBSCRIPTIONS_TABLE}
        ADD CONSTRAINT external_calendar_subscriptions_status_check
        CHECK (status IN ('active', 'expired', 'disabled', 'error'));
    `);

    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE ${SUBSCRIPTIONS_TABLE} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${SUBSCRIPTIONS_TABLE} FORCE ROW LEVEL SECURITY;
      CREATE POLICY rls_external_calendar_subscriptions_tenant
        ON ${SUBSCRIPTIONS_TABLE}
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(SUBSCRIPTIONS_TABLE);

  const hasChangeKey = await knex.schema.hasColumn(APPOINTMENTS_TABLE, 'outlook_change_key');
  if (hasChangeKey) {
    await knex.schema.alterTable(APPOINTMENTS_TABLE, (t) => {
      t.dropColumn('outlook_change_key');
      t.dropColumn('outlook_last_synced_at');
      t.dropColumn('outlook_last_modified_at');
      t.dropColumn('outlook_sync_status');
      t.dropColumn('outlook_sync_error');
    });
  }
}
