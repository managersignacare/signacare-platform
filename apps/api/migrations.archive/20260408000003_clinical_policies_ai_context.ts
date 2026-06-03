import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── clinical_policies: configurable alert-generating rules ──────────────────
  if (!(await knex.schema.hasTable('clinical_policies'))) {
    await knex.schema.createTable('clinical_policies', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.text('description').nullable();
      t.string('rule_type', 50).notNullable().defaultTo('review_interval');
      // rule_type values:
      //   review_interval    — "seen by X every Y days" (e.g. psychiatrist every 90d)
      //   pathology_interval — "test X every Y days" (e.g. metabolic panel every 90d)
      //   medication_monitoring — "if on X, monitor Y every Z days"
      //   custom             — free-text policy for LLM reference only
      t.jsonb('parameters').notNullable().defaultTo('{}');
      // parameters shape examples:
      //   { role: "Consultant Psychiatrist", intervalDays: 90, alertDaysBefore: 14 }
      //   { testType: "Metabolic Panel", intervalDays: 90, medications: ["olanzapine"], alertDaysBefore: 14 }
      //   { medicationPattern: "clozapine", monitorType: "WBC/ANC", intervalDays: 28, alertDaysBefore: 7 }
      t.text('llm_context').nullable(); // free-text context the LLM should know about this policy
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('generates_alert').notNullable().defaultTo(true); // whether this policy creates smart summary alerts
      t.boolean('available_to_llm').notNullable().defaultTo(true); // whether included in LLM RAG context
      t.string('category', 50).nullable(); // 'review', 'pathology', 'medication', 'physical_health', 'legal', 'social'
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'is_active']);
      t.index(['clinic_id', 'rule_type']);
    });

    await knex.raw('ALTER TABLE clinical_policies ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_clinical_policies_tenant ON clinical_policies
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }

  // ── ai_context_files: portable training/context for the LLM ────────────────
  // These are clinic-specific knowledge files that provide domain context to the
  // LLM. When the install location changes, export these files and import at the
  // new location — no retraining needed.
  if (!(await knex.schema.hasTable('ai_context_files'))) {
    await knex.schema.createTable('ai_context_files', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('title', 200).notNullable();
      t.text('description').nullable();
      t.string('category', 50).notNullable().defaultTo('general');
      // category: 'clinical_guidelines', 'local_protocols', 'formulary', 'service_directory',
      //           'templates', 'policies', 'training_examples', 'general'
      t.text('content').notNullable(); // the actual context text
      t.string('content_format', 20).notNullable().defaultTo('text'); // 'text', 'markdown', 'json'
      t.boolean('is_active').notNullable().defaultTo(true);
      t.boolean('include_in_rag').notNullable().defaultTo(true); // auto-inject into LLM context
      t.integer('priority').notNullable().defaultTo(50); // 0=highest, 100=lowest — controls RAG ordering
      t.integer('token_estimate').nullable(); // estimated token count for budget management
      t.uuid('uploaded_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'is_active', 'category']);
      t.index(['clinic_id', 'include_in_rag']);
    });

    await knex.raw('ALTER TABLE ai_context_files ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_ai_context_files_tenant ON ai_context_files
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_context_files');
  await knex.schema.dropTableIfExists('clinical_policies');
}
