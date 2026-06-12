import { Knex } from 'knex';

const BACKEND_CONSTRAINT = 'clinic_settings_ai_llm_backend_check';
const SCRIBE_RUNTIME_CONSTRAINT = 'clinic_settings_scribe_runtime_mode_check';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.string('ai_llm_backend', 40).notNullable().defaultTo('local_ollama');
    t.string('scribe_runtime_mode', 40).notNullable().defaultTo('standard');
    t.string('local_style_adapter_model_name', 200).nullable();
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_settings
      ADD CONSTRAINT ${BACKEND_CONSTRAINT}
      CHECK (ai_llm_backend IN ('local_ollama', 'azure_openai'))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_settings
      ADD CONSTRAINT ${SCRIBE_RUNTIME_CONSTRAINT}
      CHECK (scribe_runtime_mode IN ('standard', 'agentic'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinic_settings
      DROP CONSTRAINT IF EXISTS ${SCRIBE_RUNTIME_CONSTRAINT}
  `);

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinic_settings
      DROP CONSTRAINT IF EXISTS ${BACKEND_CONSTRAINT}
  `);

  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('local_style_adapter_model_name');
    t.dropColumn('scribe_runtime_mode');
    t.dropColumn('ai_llm_backend');
  });
}
