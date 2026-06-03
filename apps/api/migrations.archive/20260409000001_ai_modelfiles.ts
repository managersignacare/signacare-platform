import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── ai_modelfiles: per-clinic custom Ollama Modelfile + system prompts ──────
  if (!(await knex.schema.hasTable('ai_modelfiles'))) {
    await knex.schema.createTable('ai_modelfiles', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('action_type', 50).notNullable(); // ambient, maudsley, isbar, formulation, 91day, letter, discharge, med-summary, etc.
      t.string('model_name', 100).notNullable().defaultTo('qwen2.5:14b');
      t.text('modelfile_content').nullable(); // Full Ollama Modelfile template
      t.text('system_prompt').nullable(); // Custom system prompt override
      t.decimal('temperature', 3, 2).notNullable().defaultTo(0.2);
      t.integer('max_tokens').notNullable().defaultTo(4096);
      t.text('few_shot_examples').nullable(); // JSON array of example input/output pairs
      t.text('rag_instructions').nullable(); // Custom RAG retrieval instructions for this action
      t.boolean('is_active').notNullable().defaultTo(true);
      t.uuid('updated_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'action_type']);
      t.index(['clinic_id', 'is_active']);
    });

    await knex.raw('ALTER TABLE ai_modelfiles ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_ai_modelfiles_tenant ON ai_modelfiles
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_modelfiles');
}
