import type { Knex } from 'knex';

const TABLE = 'ai_provenance';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('job_id').nullable().references('id').inTable('ai_job_runs').onDelete('SET NULL');
    t.uuid('patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.string('action', 100).notNullable();
    t.string('output_hash', 128).notNullable();
    t.integer('output_length').notNullable();
    t.string('model_name', 200).notNullable();
    t.string('model_version', 255).notNullable();
    t.string('prompt_template_version', 100).notNullable().defaultTo('1.0');
    t.text('source_data_summary').nullable();
    t.boolean('validated').notNullable().defaultTo(false);
    t.jsonb('validation_warnings').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
    t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('reviewed_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.index(['clinic_id', 'created_at'], 'idx_ai_provenance_clinic_created');
    t.index(['clinic_id', 'patient_id', 'created_at'], 'idx_ai_provenance_clinic_patient_created');
    t.index(['job_id'], 'idx_ai_provenance_job_id');
    t.index(['created_by_staff_id'], 'idx_ai_provenance_created_by_staff');
    t.index(['reviewed_by_staff_id'], 'idx_ai_provenance_reviewed_by_staff');
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE ai_provenance ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ai_provenance FORCE ROW LEVEL SECURITY;
    CREATE POLICY rls_ai_provenance_tenant
      ON ai_provenance
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_ai_provenance_updated_at
      BEFORE UPDATE ON ai_provenance
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: trigger_drop
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_ai_provenance_updated_at ON ai_provenance;
  `);
  await knex.schema.dropTableIfExists(TABLE);
}
