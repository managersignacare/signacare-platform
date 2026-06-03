import { Knex } from 'knex';

/**
 * Audit Tier 12 — Scribe gap Phase 2 DB layer.
 *
 * Four DDL changes in one migration — all concern scribe workflow
 * state that the existing scribe_consents + llm_interactions tables
 * don't cover:
 *
 *   1. clinic_scribe_vocabulary (12.5) — per-clinic custom vocabulary
 *      (drug brands, protocol names, local terms) composed into
 *      Whisper's initial_prompt. Covers specialty-specific drugs + local
 *      hospital abbreviations. Admin manages via Power Settings CRUD.
 *
 *   2. scribe_sessions (12.8) — per-session state (pause / resume /
 *      clinician / patient / started_at / ended_at). Mid-session pause
 *      supports clinician interruptions (handovers, calls) without
 *      splitting the transcript into two artefacts.
 *
 *   3. admin_impersonation_sessions (12.13) — short-lived
 *      impersonation tokens for audit-review. Superadmin or medical
 *      director assumes a clinician identity for ≤15min, every
 *      audit_log row records BOTH actor ids.
 *
 * RLS + indexes + CHECK constraints per §6.3 / §7.1 / §12.4.
 */
export async function up(knex: Knex): Promise<void> {
  // 12.5 — clinic_scribe_vocabulary
  await knex.schema.createTable('clinic_scribe_vocabulary', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('category', 40).notNullable();
    t.string('term', 200).notNullable();
    t.string('pronunciation_hint', 200).nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['clinic_id', 'category', 'is_active'], 'idx_scribe_vocab_clinic_cat_active');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_scribe_vocabulary
      ADD CONSTRAINT clinic_scribe_vocabulary_category_check
      CHECK (category IN ('drug_brand','drug_generic','allergen_common','protocol_name','condition','local_name'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE clinic_scribe_vocabulary ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinic_scribe_vocabulary_tenant ON clinic_scribe_vocabulary
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 12.8 — scribe_sessions
  await knex.schema.createTable('scribe_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('clinician_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('consent_id').nullable().references('id').inTable('scribe_consents').onDelete('SET NULL');
    t.string('status', 20).notNullable().defaultTo('active');
    t.boolean('whisper_mode').notNullable().defaultTo(false);
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('paused_at', { useTz: true }).nullable();
    t.timestamp('resumed_at', { useTz: true }).nullable();
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['clinician_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'status']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_sessions
      ADD CONSTRAINT scribe_sessions_status_check
      CHECK (status IN ('active','paused','completed','abandoned'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE scribe_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_scribe_sessions_tenant ON scribe_sessions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 12.13 — admin_impersonation_sessions
  await knex.schema.createTable('admin_impersonation_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('admin_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('impersonated_staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.string('reason', 500).notNullable();
    t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['admin_id']);
    t.index(['impersonated_staff_id']);
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_admin_impersonation_sessions_tenant ON admin_impersonation_sessions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_admin_impersonation_sessions_tenant ON admin_impersonation_sessions');
  await knex.schema.dropTableIfExists('admin_impersonation_sessions');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_scribe_sessions_tenant ON scribe_sessions');
  await knex.schema.dropTableIfExists('scribe_sessions');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_clinic_scribe_vocabulary_tenant ON clinic_scribe_vocabulary');
  await knex.schema.dropTableIfExists('clinic_scribe_vocabulary');
}
