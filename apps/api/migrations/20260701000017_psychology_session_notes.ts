import { Knex } from 'knex';

/**
 * Audit Tier 6.2 (MED-H2) — psychology session notes.
 *
 * Psychology session notes are the psychologist's equivalent of the
 * psychiatrist's clinical formulations. They follow the same
 * confidentiality model (author + shared-with-clinicians) but are
 * stored in their own table so the psychiatrist's / clinician's
 * reading paths never inadvertently surface psychology content.
 *
 * Access model (enforced in the companion routes):
 *   - psychologist author — full read/write
 *   - admin / superadmin — read (for governance)
 *   - other clinicians — blocked unless shared_with_clinicians=true
 *   - psychiatrist — same as other clinicians (no special read path)
 *
 * Columns:
 *   id, clinic_id, patient_id, episode_id (nullable),
 *   staff_id (author — the psychologist),
 *   session_date, duration_min, session_type,
 *   content (text; pgcrypto encryption at rest is a v2.0 follow-up),
 *   outcome_scores (jsonb — K10 / DASS-21 / YPCORE etc.),
 *   shared_with_clinicians (bool, default false),
 *   created_at, updated_at, deleted_at
 *
 * RLS: tenant policy per §6.3. Indexed FKs per §7.1.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('psychology_session_notes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.date('session_date').notNullable();
    t.integer('duration_min').nullable();
    t.string('session_type', 60).nullable();
    t.text('content').nullable();
    t.jsonb('outcome_scores').nullable();
    t.boolean('shared_with_clinicians').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();
    // §7.1 — indexed FKs + the filter the GET-list uses.
    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['episode_id']);
    t.index(['staff_id']);
    t.index(['clinic_id', 'shared_with_clinicians']);
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE psychology_session_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_psychology_session_notes_tenant ON psychology_session_notes
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_psychology_session_notes_tenant ON psychology_session_notes');
  await knex.schema.dropTableIfExists('psychology_session_notes');
}
