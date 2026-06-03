/**
 * Phase 0.7.2 #21 — Active session tracking for concurrent
 * session control. Limits the number of simultaneous logins
 * per staff member so stolen credentials can be detected and
 * force-logged-out.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('active_sessions'))) {
    await knex.schema.createTable('active_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.string('refresh_token_jti', 64).notNullable();
      t.string('ip_address', 45).nullable();
      t.string('user_agent', 500).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('expires_at', { useTz: true }).notNullable();
      t.timestamp('revoked_at', { useTz: true }).nullable();
      t.index(['staff_id']);
      t.index(['clinic_id']);
      t.index(['refresh_token_jti']);
    });

    await knex.raw(`
      ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS rls_active_sessions_tenant ON active_sessions;
      CREATE POLICY rls_active_sessions_tenant ON active_sessions
        FOR ALL
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
    `);

    const hasAppUser = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
    if ((hasAppUser.rows ?? []).length > 0) {
      await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON active_sessions TO app_user`);
    }
  }

  // Add max_concurrent_sessions to staff table
  if (await knex.schema.hasTable('staff')) {
    if (!(await knex.schema.hasColumn('staff', 'max_concurrent_sessions'))) {
      await knex.schema.alterTable('staff', (t) => {
        t.integer('max_concurrent_sessions').notNullable().defaultTo(3);
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('active_sessions');
  if (await knex.schema.hasColumn('staff', 'max_concurrent_sessions')) {
    await knex.schema.alterTable('staff', (t) => t.dropColumn('max_concurrent_sessions'));
  }
}
