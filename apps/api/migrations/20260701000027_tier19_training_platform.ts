import { Knex } from 'knex';

/**
 * Audit Tier 19 — training platform (final tier of Phase R).
 *
 * The platform is the long-term answer to the questions Tiers 5 + 8
 * raised but couldn't close: "how does a local model get from
 * clinician transcript → sanitised training corpus → fine-tuned
 * model → canary deploy → production?" Tier 19 lands the structural
 * scaffolding for every stage so the eventual implementation is
 * mechanical.
 *
 * Tables:
 *
 *   1. phi_scrubber_rules (19.1) — regex rule library for
 *      de-identifying transcripts before they enter the training
 *      corpus. Rules are category-tagged (names / phone / email /
 *      address / mrn / date_of_birth / ihi / medicare / third_party)
 *      and ordered by precedence. Seeded with conservative defaults;
 *      admin can add per-clinic rules for local abbreviations +
 *      aliases.
 *
 *   2. training_corpus_items (19.2) — the central pool. One row per
 *      sanitised transcript accepted into training. Each item has
 *      its source_session_id (scribe), the scrubber version that
 *      produced it, reviewer sign-off, and optional rejection reason.
 *      RLS is NOT applied because the pool is vendor-level, but
 *      every row carries `source_clinic_id` for audit.
 *
 *   3. model_registry (19.3) — one row per model version (Ollama
 *      model tag + Whisper variant + embedding model version). Every
 *      registered version carries eval_scores JSONB, red_team_pass
 *      boolean, and registered_by. Red-team gate at Tier 19.5
 *      enforces red_team_pass=true before any deploy.
 *
 *   4. model_deployments (19.4) — deployment state machine per
 *      tenant. status: canary / rollout / active / rolled_back.
 *      Canary traffic_percentage bumps from 0 → 100 via admin action;
 *      a rollback records reason + returns the prior active version.
 *
 *   5. model_surveillance_events (19.6) — post-deploy monitoring
 *      events (outlier outputs, user rejection spikes, flagged
 *      critical sensitive-topic misclassifications). Feeds the admin
 *      dashboard + canary rollback decisions.
 *
 *   6. clinic_settings.training_opt_in (19.7) — per-clinic toggle
 *      for contributing sanitised transcripts to the central pool.
 *      Default: false. Clinics must explicitly opt in.
 *
 * RLS on tenant tables (model_deployments is per-clinic); vendor-
 * global tables (phi_scrubber_rules, training_corpus_items,
 * model_registry, model_surveillance_events) are admin-curated and
 * accessed only via the admin dashboard (application-level guards).
 */
export async function up(knex: Knex): Promise<void> {
  // 19.1 — phi_scrubber_rules
  await knex.schema.createTable('phi_scrubber_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').nullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('category', 40).notNullable();
    t.string('name', 200).notNullable();
    t.text('pattern').notNullable();
    t.string('replacement', 100).notNullable().defaultTo('[REDACTED]');
    t.integer('precedence').notNullable().defaultTo(100);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['category', 'is_active']);
    t.index(['precedence']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE phi_scrubber_rules
      ADD CONSTRAINT phi_scrubber_rules_category_check
      CHECK (category IN (
        'names','phone','email','address','mrn','date_of_birth',
        'ihi','medicare','third_party','case_note_id','custom'
      ))
  `);

  // RLS allows system rows (clinic_id NULL) + per-clinic overrides.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE phi_scrubber_rules ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_phi_scrubber_rules_tenant ON phi_scrubber_rules
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

  // 19.2 — training_corpus_items (vendor-level central pool)
  await knex.schema.createTable('training_corpus_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('source_clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('source_session_id').nullable().references('id').inTable('scribe_sessions').onDelete('SET NULL');
    t.string('scrubber_version', 40).notNullable();
    t.text('sanitised_transcript').notNullable();
    t.jsonb('redaction_summary').notNullable();
    t.string('status', 20).notNullable().defaultTo('pending_review');
    t.uuid('reviewed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['source_clinic_id']);
    t.index(['status']);
    t.index(['scrubber_version']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE training_corpus_items
      ADD CONSTRAINT training_corpus_items_status_check
      CHECK (status IN ('pending_review','accepted','rejected','superseded'))
  `);

  // Tenant-scoped by source_clinic_id.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE training_corpus_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_training_corpus_items_tenant ON training_corpus_items;
    CREATE POLICY rls_training_corpus_items_tenant ON training_corpus_items
      FOR ALL
      USING (source_clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (source_clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 19.3 — model_registry (vendor-level)
  await knex.schema.createTable('model_registry', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('model_kind', 40).notNullable();
    t.string('name', 200).notNullable();
    t.string('version', 100).notNullable();
    t.string('provider', 40).notNullable();
    t.string('digest_sha256', 64).nullable();
    t.jsonb('eval_scores').nullable();
    t.boolean('red_team_pass').notNullable().defaultTo(false);
    t.text('red_team_report_ref').nullable();
    t.uuid('registered_by').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('registered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.boolean('is_active').notNullable().defaultTo(true);
    t.unique(['model_kind', 'name', 'version']);
    t.index(['model_kind', 'is_active']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE model_registry
      ADD CONSTRAINT model_registry_kind_check
      CHECK (model_kind IN (
        'scribe_llm','whisper_stt','embedding','classifier','translation','redactor'
      ))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE model_registry
      ADD CONSTRAINT model_registry_provider_check
      CHECK (provider IN ('ollama','openai','anthropic','local_hf','other'))
  `);

  // System-catalog table. App-user sessions should not read/write rows.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_model_registry_admin_only ON model_registry;
    CREATE POLICY rls_model_registry_admin_only ON model_registry
      FOR ALL
      USING (current_user = 'signacare_owner')
      WITH CHECK (current_user = 'signacare_owner');
  `);

  // 19.4 — model_deployments (per-clinic)
  await knex.schema.createTable('model_deployments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('model_id').notNullable().references('id').inTable('model_registry').onDelete('RESTRICT');
    t.string('status', 20).notNullable().defaultTo('canary');
    t.integer('traffic_percentage').notNullable().defaultTo(0);
    t.uuid('deployed_by').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('deployed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('promoted_at', { useTz: true }).nullable();
    t.timestamp('rolled_back_at', { useTz: true }).nullable();
    t.text('rollback_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['clinic_id', 'status'], 'idx_model_deployments_active');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE model_deployments
      ADD CONSTRAINT model_deployments_status_check
      CHECK (status IN ('canary','rollout','active','rolled_back','superseded'))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE model_deployments
      ADD CONSTRAINT model_deployments_traffic_check
      CHECK (traffic_percentage >= 0 AND traffic_percentage <= 100)
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE model_deployments ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_model_deployments_tenant ON model_deployments
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 19.6 — model_surveillance_events (vendor-level aggregator)
  await knex.schema.createTable('model_surveillance_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('source_clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('deployment_id').nullable().references('id').inTable('model_deployments').onDelete('SET NULL');
    t.uuid('model_id').nullable().references('id').inTable('model_registry').onDelete('SET NULL');
    t.string('event_type', 40).notNullable();
    t.string('severity', 20).notNullable().defaultTo('info');
    t.jsonb('payload').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['source_clinic_id']);
    t.index(['model_id']);
    t.index(['event_type', 'severity']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE model_surveillance_events
      ADD CONSTRAINT model_surveillance_events_type_check
      CHECK (event_type IN (
        'outlier_output','user_rejection_spike','sensitive_flag_miss',
        'latency_p99_breach','cost_anomaly','canary_failure','rollback_triggered'
      ))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE model_surveillance_events
      ADD CONSTRAINT model_surveillance_events_severity_check
      CHECK (severity IN ('info','warning','high','critical'))
  `);

  // Tenant-scoped by source_clinic_id.
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE model_surveillance_events ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_model_surveillance_events_tenant ON model_surveillance_events;
    CREATE POLICY rls_model_surveillance_events_tenant ON model_surveillance_events
      FOR ALL
      USING (source_clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (source_clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 19.7 — clinic_settings.training_opt_in
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.boolean('training_opt_in').notNullable().defaultTo(false);
    t.string('training_opt_in_changed_by', 100).nullable();
    t.timestamp('training_opt_in_changed_at', { useTz: true }).nullable();
  });

  // 19.1 — seed conservative PHI scrubber defaults as vendor-global
  // rows. These are intentionally over-inclusive — false positives
  // are preferable to false negatives when sanitising training data.
  // The precedence ordering means most-specific rules run first.
  await knex('phi_scrubber_rules').insert([
    {
      clinic_id: null, category: 'ihi', name: '16-digit IHI',
      pattern: '\\b80\\d{14}\\b', replacement: '[IHI]', precedence: 10, is_active: true,
    },
    {
      clinic_id: null, category: 'medicare', name: '10-digit Medicare number',
      pattern: '\\b[2-6]\\d{9}\\b', replacement: '[MEDICARE]', precedence: 20, is_active: true,
    },
    {
      clinic_id: null, category: 'phone', name: 'AU mobile phone',
      pattern: '\\b04\\d{2}\\s?\\d{3}\\s?\\d{3}\\b', replacement: '[PHONE]', precedence: 30, is_active: true,
    },
    {
      clinic_id: null, category: 'phone', name: 'AU landline +61',
      pattern: '\\b(?:\\+?61|0)[23478]\\s?\\d{4}\\s?\\d{4}\\b', replacement: '[PHONE]', precedence: 31, is_active: true,
    },
    {
      clinic_id: null, category: 'email', name: 'Email address',
      pattern: '\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b', replacement: '[EMAIL]', precedence: 40, is_active: true,
    },
    {
      clinic_id: null, category: 'date_of_birth', name: 'AU date of birth (dd/mm/yyyy)',
      pattern: '\\b(0?[1-9]|[12][0-9]|3[01])/(0?[1-9]|1[012])/(19|20)\\d{2}\\b', replacement: '[DOB]', precedence: 50, is_active: true,
    },
    {
      clinic_id: null, category: 'mrn', name: 'Local MRN (7-8 digit)',
      pattern: '\\bMRN[:\\s]+\\d{6,8}\\b', replacement: 'MRN [REDACTED]', precedence: 60, is_active: true,
    },
    {
      clinic_id: null, category: 'address', name: 'AU postcode',
      pattern: '\\b(0800|0810|0830|0870|0880|2[0-9]{3}|3[0-9]{3}|4[0-9]{3}|5[0-9]{3}|6[0-9]{3}|7[0-9]{3})\\b',
      replacement: '[POSTCODE]', precedence: 70, is_active: true,
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('training_opt_in_changed_at');
    t.dropColumn('training_opt_in_changed_by');
    t.dropColumn('training_opt_in');
  });

  await knex.schema.dropTableIfExists('model_surveillance_events');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_model_deployments_tenant ON model_deployments');
  await knex.schema.dropTableIfExists('model_deployments');

  await knex.schema.dropTableIfExists('model_registry');
  await knex.schema.dropTableIfExists('training_corpus_items');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_phi_scrubber_rules_tenant ON phi_scrubber_rules');
  await knex.schema.dropTableIfExists('phi_scrubber_rules');
}
