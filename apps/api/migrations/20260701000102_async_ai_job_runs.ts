import type { Knex } from 'knex';

const TABLE = 'ai_job_runs';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('RESTRICT');
    t.uuid('consent_id').nullable().references('id').inTable('scribe_consents').onDelete('RESTRICT');
    t.string('action', 100).notNullable();
    t.string('status', 40).notNullable().defaultTo('queued');
    t.integer('progress_percent').notNullable().defaultTo(0);
    t.string('stage', 80).nullable();
    t.text('status_message').nullable();
    t.string('model', 200).nullable();
    t.text('input_summary').nullable();
    t.jsonb('queue_payload').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.text('result_text').nullable();
    t.jsonb('result_json').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.string('output_hash', 128).nullable();
    t.boolean('validation_valid').nullable();
    t.string('error_code', 120).nullable();
    t.text('error_message').nullable();
    t.jsonb('validation_warnings').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
    t.string('audio_storage_key', 1024).nullable();
    t.string('audio_storage_backend', 40).nullable();
    t.string('audio_storage_bucket', 255).nullable();
    t.string('audio_mime_type', 120).nullable();
    t.string('audio_retention_policy', 40).nullable();
    t.timestamp('audio_deleted_at', { useTz: true }).nullable();
    t.integer('duration_ms').nullable();
    t.timestamp('queued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('started_at', { useTz: true }).nullable();
    t.timestamp('completed_at', { useTz: true }).nullable();
    t.timestamp('failed_at', { useTz: true }).nullable();
    t.integer('lock_version').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'staff_id', 'status', 'created_at'], 'idx_ai_job_runs_clinic_staff_status_created');
    t.index(['clinic_id', 'patient_id', 'created_at'], 'idx_ai_job_runs_clinic_patient_created');
    t.index(['clinic_id', 'consent_id', 'created_at'], 'idx_ai_job_runs_clinic_consent_created');
    t.index(['clinic_id', 'action', 'created_at'], 'idx_ai_job_runs_clinic_action_created');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE ai_job_runs
      ADD CONSTRAINT ai_job_runs_status_check
      CHECK (status IN ('queued', 'retrying', 'processing', 'transcribing', 'generating', 'validating', 'completed', 'failed', 'cancelled'));
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE ai_job_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ai_job_runs FORCE ROW LEVEL SECURITY;
    CREATE POLICY rls_ai_job_runs_tenant
      ON ai_job_runs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_ai_job_runs_updated_at
      BEFORE UPDATE ON ai_job_runs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_ai_job_runs_updated_at ON ai_job_runs;
  `);
  await knex.schema.dropTableIfExists(TABLE);
}
