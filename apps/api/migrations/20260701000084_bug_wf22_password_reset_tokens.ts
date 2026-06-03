import type { Knex } from 'knex';

/**
 * BUG-WF22-PWD-RESET-MISSING
 *
 * Adds first-class password reset token persistence so auth/password-reset
 * request + confirm routes can be implemented server-side.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('password_reset_tokens');
  if (exists) return;

  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at').nullable();
    t.string('requested_ip', 120).nullable();
    t.string('requested_user_agent', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['staff_id']);
  });

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_active_unique
      ON password_reset_tokens (staff_id)
      WHERE used_at IS NULL;
  `);
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS password_reset_tokens_token_hash_idx
      ON password_reset_tokens (token_hash);
  `);
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx
      ON password_reset_tokens (expires_at);
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
  `);
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
  `);
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    CREATE POLICY rls_password_reset_tokens_tenant
      ON password_reset_tokens
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: rls_policy
  await knex.raw('ALTER TABLE password_reset_tokens NO FORCE ROW LEVEL SECURITY');
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_password_reset_tokens_tenant ON password_reset_tokens');
  await knex.schema.dropTableIfExists('password_reset_tokens');
}
