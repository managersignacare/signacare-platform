import { Knex } from 'knex';

/**
 * Audit Tier 13 — scribe safety + semantic search + talk-time + nursing.
 *
 * Five DDL changes in one migration — all concern scribe-pipeline
 * metadata that the existing `scribe_consents` + `scribe_sessions` +
 * `llm_interactions` tables don't cover:
 *
 *   1. pgvector extension (13.3) — semantic-search backing for the
 *      scribe transcript corpus. Idempotent; superuser-only, but the
 *      migration runs under `signacare_owner` which delegates via
 *      `CREATE EXTENSION IF NOT EXISTS`. Production DBs that don't
 *      have the extension pre-installed will fail this step loudly —
 *      that's the intent (no silent no-op).
 *
 *   2. scribe_sensitive_flags (13.1) — per-session rows for any
 *      sensitive-topic match (self-harm, abuse, violence, substance
 *      misuse, DV, child-protection). Severity enforced by CHECK;
 *      severe flags trigger admin-alert side-effect in the service
 *      layer. Not clinical content — pattern-match metadata only.
 *
 *   3. scribe_action_items (13.2) — extracted actionable items (tasks,
 *      medication changes, referrals, investigations, follow-ups)
 *      queued for clinician review. Never auto-applied; a clinician
 *      must explicitly accept each one to create the downstream EHR
 *      row. Status column tracks review state.
 *
 *   4. scribe_talk_time_metrics (13.4) — per-session speaker ratios
 *      computed from Whisper diarisation output. `clinician_seconds`
 *      + `patient_seconds` + `silence_seconds`; ratio derived at read.
 *
 *   5. scribe_note_templates (13.5) — variant templates (psychiatric,
 *      nursing, social-work, GP, outpatient-dictation). System +
 *      per-clinic overrides. Used by the nursing scribe variant and
 *      future variants.
 *
 * pgvector column on llm_interactions: `embedding vector(1536)`
 * follows OpenAI / local-model default dimension; nullable because
 * old rows won't have embeddings. Partial index on the column for
 * kNN search.
 *
 * RLS + indexes + CHECK constraints per §6.3 / §7.1 / §12.4.
 */
  export async function up(knex: Knex): Promise<void> {
    // 13.3 — pgvector extension.
    // @migration-raw-exempt: extension_create
    let pgvectorAvailable = true;
    try {
      // @migration-raw-exempt: extension_create
      await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (error) {
      if (process.env.ALLOW_MISSING_PGVECTOR !== 'true') {
      throw error;
    }
    pgvectorAvailable = false;
    // Explicit degraded mode for Windows/dev hosts where pgvector is not installed.
    console.warn('[migration:20260701000021] pgvector extension unavailable; continuing without llm_interactions.embedding (ALLOW_MISSING_PGVECTOR=true)');
  }

  // 13.3 — add embedding column to llm_interactions so scribe transcript
  // rows can be kNN-searched. vector(1536) matches the OpenAI
  // text-embedding-3-small + common local model output dimension.
  //
  // Phase 0b.1c (2026-05-04): JS-level idempotency guard via hasColumn,
  // not raw `ADD COLUMN IF NOT EXISTS` — column DDL must be expressible
  // through the Knex builder so the migration-driven type generator
  // (Phase 0b.1a/b) sees this column add. `t.specificType` is the
  // canonical builder escape for Postgres-specific types like vector.
  if (pgvectorAvailable && !(await knex.schema.hasColumn('llm_interactions', 'embedding'))) {
    await knex.schema.alterTable('llm_interactions', (t) => {
      t.specificType('embedding', 'vector(1536)');
    });
  }

    // 13.3 — IVFFlat index for fast cosine-similarity search. Partial on
    // rows that actually have embeddings. Uses 100 lists per pgvector
    // docs as a reasonable default for corpus <1M rows; production
    // would tune this after measuring recall/latency.
    if (pgvectorAvailable) {
      // @migration-raw-exempt: index_partial
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_llm_interactions_embedding_ivfflat
          ON llm_interactions USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
        WHERE embedding IS NOT NULL
    `);
  }

  // 13.1 — scribe_sensitive_flags
  await knex.schema.createTable('scribe_sensitive_flags', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('session_id').notNullable().references('id').inTable('scribe_sessions').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('category', 40).notNullable();
    t.string('severity', 20).notNullable();
    // Character offset in the transcript where the match occurred —
    // lets the UI highlight the context snippet without storing the
    // full transcript text again.
    t.integer('transcript_offset').nullable();
    t.string('snippet', 200).nullable();
    t.uuid('reviewed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.string('review_disposition', 40).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['session_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'severity', 'reviewed_at'], 'idx_sensitive_flags_triage');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_sensitive_flags
      ADD CONSTRAINT scribe_sensitive_flags_category_check
      CHECK (category IN (
        'self_harm','suicide_intent','violence_to_others','abuse_disclosure',
        'child_protection','domestic_violence','substance_misuse',
        'sexual_assault','eating_disorder_critical','psychosis_acute'
      ))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_sensitive_flags
      ADD CONSTRAINT scribe_sensitive_flags_severity_check
      CHECK (severity IN ('low','moderate','high','critical'))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_sensitive_flags
      ADD CONSTRAINT scribe_sensitive_flags_disposition_check
      CHECK (review_disposition IS NULL OR review_disposition IN (
        'false_positive','acknowledged','escalated','action_taken'
      ))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE scribe_sensitive_flags ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_scribe_sensitive_flags_tenant ON scribe_sensitive_flags
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 13.2 — scribe_action_items
  await knex.schema.createTable('scribe_action_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('session_id').notNullable().references('id').inTable('scribe_sessions').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.string('item_type', 40).notNullable();
    t.string('description', 1000).notNullable();
    t.string('assignee_role', 40).nullable();
    t.date('due_date').nullable();
    t.string('status', 20).notNullable().defaultTo('pending_review');
    // When the clinician accepts an action item, we store the ID of
    // the downstream row (task / medication / referral) so the chain
    // of provenance is preserved.
    t.string('downstream_table', 60).nullable();
    t.uuid('downstream_id').nullable();
    t.uuid('reviewed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['session_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'status']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_action_items
      ADD CONSTRAINT scribe_action_items_type_check
      CHECK (item_type IN (
        'task','medication_change','medication_new','referral',
        'investigation','followup','letter','escalation'
      ))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_action_items
      ADD CONSTRAINT scribe_action_items_status_check
      CHECK (status IN ('pending_review','accepted','rejected','applied','expired'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE scribe_action_items ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_scribe_action_items_tenant ON scribe_action_items
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 13.4 — scribe_talk_time_metrics
  await knex.schema.createTable('scribe_talk_time_metrics', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('session_id').notNullable().references('id').inTable('scribe_sessions').onDelete('CASCADE');
    t.integer('clinician_seconds').notNullable().defaultTo(0);
    t.integer('patient_seconds').notNullable().defaultTo(0);
    t.integer('silence_seconds').notNullable().defaultTo(0);
    t.integer('total_seconds').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.unique(['session_id']);
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE scribe_talk_time_metrics ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_scribe_talk_time_metrics_tenant ON scribe_talk_time_metrics
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 13.5 — scribe_note_templates. System defaults have `clinic_id`
  // NULL so they're visible to every tenant; clinic overrides carry
  // a non-null `clinic_id`. The RLS policy allows both.
  await knex.schema.createTable('scribe_note_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('variant', 40).notNullable();
    t.string('name', 200).notNullable();
    t.text('system_prompt').notNullable();
    t.text('user_prompt_template').notNullable();
    t.jsonb('sections').notNullable().defaultTo('[]');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['variant']);
    t.index(['clinic_id', 'variant', 'is_active'], 'idx_scribe_note_templates_lookup');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_note_templates
      ADD CONSTRAINT scribe_note_templates_variant_check
      CHECK (variant IN (
        'psychiatric','psychology','nursing','social_work',
        'gp','outpatient_dictation','allied_health'
      ))
  `);

  // Vendor-global + per-clinic rows share the same table. The policy
  // allows clinic_id NULL (system defaults) OR match on current tenant.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE scribe_note_templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_scribe_note_templates_tenant ON scribe_note_templates
      FOR ALL
      USING (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      )
      WITH CHECK (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      );
  `);

  // 13.5 — seed the nursing + psychiatric + psychology variants as
  // vendor-global system templates. Clinic overrides plug in via the
  // same table with a non-null clinic_id.
  await knex('scribe_note_templates').insert([
    {
      clinic_id: null,
      variant: 'psychiatric',
      name: 'Psychiatric consultation (default)',
      system_prompt: 'You are a senior Australian psychiatrist. Produce a structured consultation note using the sections provided. Australian English. Use ICD-10-AM codes. Do NOT invent facts not present in the transcript.',
      user_prompt_template: 'Transcript:\n---\n{{transcript}}\n---\nWrite the consultation note now:',
      sections: JSON.stringify(['Presenting complaint', 'History', 'Mental state exam', 'Risk', 'Formulation', 'Plan']),
      is_active: true,
    },
    {
      clinic_id: null,
      variant: 'nursing',
      name: 'Nursing observation note (default)',
      system_prompt: 'You are a mental health registered nurse documenting an observation round or intervention. Focus on objective observations, interventions delivered, patient response, and escalation needs. Do NOT diagnose — defer diagnostic language to the treating team.',
      user_prompt_template: 'Transcript / observations:\n---\n{{transcript}}\n---\nWrite the nursing note now:',
      sections: JSON.stringify(['Observations', 'Nursing interventions', 'Patient response', 'Escalation', 'Handover']),
      is_active: true,
    },
    {
      clinic_id: null,
      variant: 'psychology',
      name: 'Psychology session note (default)',
      system_prompt: 'You are a clinical psychologist documenting a therapy session. Use the client\'s language where therapeutic. Note the intervention model (CBT / ACT / DBT / schema / etc.), specific techniques used, and the client\'s response. Avoid medicalising language.',
      user_prompt_template: 'Session transcript:\n---\n{{transcript}}\n---\nWrite the session note now:',
      sections: JSON.stringify(['Session focus', 'Techniques used', 'Client response', 'Homework', 'Next session plan']),
      is_active: true,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_scribe_note_templates_tenant ON scribe_note_templates');
  await knex.schema.dropTableIfExists('scribe_note_templates');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_scribe_talk_time_metrics_tenant ON scribe_talk_time_metrics');
  await knex.schema.dropTableIfExists('scribe_talk_time_metrics');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_scribe_action_items_tenant ON scribe_action_items');
  await knex.schema.dropTableIfExists('scribe_action_items');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_scribe_sensitive_flags_tenant ON scribe_sensitive_flags');
  await knex.schema.dropTableIfExists('scribe_sensitive_flags');

  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS idx_llm_interactions_embedding_ivfflat');
  // Phase 0b.1c (2026-05-04): JS-level idempotency guard for the embedding
  // column drop — column DDL inside knex.raw() is rejected by the
  // second-line-defense guard (`check-no-column-ddl-in-raw-sql`).
  if (await knex.schema.hasColumn('llm_interactions', 'embedding')) {
    await knex.schema.alterTable('llm_interactions', (t) => {
      t.dropColumn('embedding');
    });
  }
  // Deliberately NOT dropping the vector extension in down() — other
  // databases on the same cluster may use it.
}
