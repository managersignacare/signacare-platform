import type { Knex } from 'knex';

/**
 * Digital Care Pathways foundation:
 * - clinic_step_care_rules: configurable step-care automation rules
 * - step_care_rule_events: idempotent assignment/escalation event ledger
 * - patient_device_sources: wearable/device source registry
 * - patient_digital_phenotypes: derived risk snapshots from tracking streams
 */
export async function up(knex: Knex): Promise<void> {
  const hasStepCareRules = await knex.schema.hasTable('clinic_step_care_rules');
  if (!hasStepCareRules) {
    await knex.schema.createTable('clinic_step_care_rules', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('name', 160).notNullable();
      t.text('description').nullable();
      t.string('pathway_type', 80).notNullable();
      t.string('intervention_template_key', 80).notNullable();
      t.boolean('auto_assign_enabled').notNullable().defaultTo(true);
      t.boolean('auto_escalate_enabled').notNullable().defaultTo(true);
      t.string('escalation_priority', 20).notNullable().defaultTo('high');
      t.string('assignment_scope', 40).notNullable().defaultTo('primary_clinician');
      t.boolean('is_active').notNullable().defaultTo(true);
      t.text('expected_outcome_text').nullable();
      t.jsonb('conditions').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.integer('lock_version').notNullable().defaultTo(1);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'name'], { indexName: 'uq_step_care_rules_clinic_name' });
      t.index(['clinic_id', 'is_active'], 'idx_step_care_rules_clinic_active');
      t.index(['clinic_id', 'pathway_type'], 'idx_step_care_rules_clinic_pathway_type');
      t.index(['created_by_staff_id'], 'idx_step_care_rules_created_by_staff');
    });

    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE clinic_step_care_rules ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_step_care_rules_tenant ON clinic_step_care_rules
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_step_care_rules_updated_at ON clinic_step_care_rules;
      CREATE TRIGGER trg_step_care_rules_updated_at
        BEFORE UPDATE ON clinic_step_care_rules
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  const hasStepCareEvents = await knex.schema.hasTable('step_care_rule_events');
  if (!hasStepCareEvents) {
    await knex.schema.createTable('step_care_rule_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('rule_id').notNullable().references('id').inTable('clinic_step_care_rules').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('pathway_id').nullable().references('id').inTable('treatment_pathways').onDelete('SET NULL');
      t.string('event_type', 40).notNullable();
      t.string('fingerprint', 255).notNullable();
      t.jsonb('details').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'fingerprint'], { indexName: 'uq_step_care_rule_events_fingerprint' });
      t.index(['clinic_id', 'event_type', 'created_at'], 'idx_step_care_rule_events_clinic_event_type_created');
      t.index(['clinic_id', 'patient_id', 'created_at'], 'idx_step_care_rule_events_clinic_patient_created');
      t.index(['rule_id'], 'idx_step_care_rule_events_rule_id');
      t.index(['patient_id'], 'idx_step_care_rule_events_patient_id');
      t.index(['pathway_id'], 'idx_step_care_rule_events_pathway_id');
    });

    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE step_care_rule_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_step_care_rule_events_tenant ON step_care_rule_events
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    `);
  }

  const hasDeviceSources = await knex.schema.hasTable('patient_device_sources');
  if (!hasDeviceSources) {
    await knex.schema.createTable('patient_device_sources', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('provider', 40).notNullable();
      t.string('device_label', 120).notNullable();
      t.string('external_device_id', 200).nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      t.timestamp('last_ingested_at', { useTz: true }).nullable();
      t.integer('lock_version').notNullable().defaultTo(1);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'patient_id', 'provider', 'device_label'], {
        indexName: 'uq_patient_device_sources_clinic_patient_provider_label',
      });
      t.index(['clinic_id', 'patient_id', 'is_active'], 'idx_patient_device_sources_clinic_patient_active');
      t.index(['patient_id'], 'idx_patient_device_sources_patient_id');
    });

    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_device_sources ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_device_sources_tenant ON patient_device_sources
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_patient_device_sources_updated_at ON patient_device_sources;
      CREATE TRIGGER trg_patient_device_sources_updated_at
        BEFORE UPDATE ON patient_device_sources
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  const hasPhenotypes = await knex.schema.hasTable('patient_digital_phenotypes');
  if (!hasPhenotypes) {
    await knex.schema.createTable('patient_digital_phenotypes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.date('computation_day').notNullable();
      t.integer('lookback_days').notNullable().defaultTo(14);
      t.decimal('sleep_hours_avg_7d', 7, 2).nullable();
      t.decimal('steps_avg_7d', 10, 2).nullable();
      t.decimal('resting_hr_avg_7d', 7, 2).nullable();
      t.decimal('hrv_avg_7d', 10, 2).nullable();
      t.decimal('mood_avg_7d', 7, 2).nullable();
      t.decimal('anxiety_avg_7d', 7, 2).nullable();
      t.decimal('adherence_score', 7, 2).notNullable().defaultTo(0);
      t.decimal('risk_index', 7, 2).notNullable().defaultTo(0);
      t.string('risk_band', 20).notNullable().defaultTo('low');
      t.jsonb('contributing_signals').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      t.integer('lock_version').notNullable().defaultTo(1);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'patient_id', 'computation_day'], {
        indexName: 'uq_patient_digital_phenotypes_clinic_patient_day',
      });
      t.index(['clinic_id', 'patient_id', 'created_at'], 'idx_patient_digital_phenotypes_clinic_patient_created');
      t.index(['clinic_id', 'risk_band', 'created_at'], 'idx_patient_digital_phenotypes_clinic_risk_band_created');
      t.index(['patient_id'], 'idx_patient_digital_phenotypes_patient_id');
    });

    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_digital_phenotypes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_digital_phenotypes_tenant ON patient_digital_phenotypes
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_patient_digital_phenotypes_updated_at ON patient_digital_phenotypes;
      CREATE TRIGGER trg_patient_digital_phenotypes_updated_at
        BEFORE UPDATE ON patient_digital_phenotypes
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('patient_digital_phenotypes')) {
    await knex.schema.dropTableIfExists('patient_digital_phenotypes');
  }
  if (await knex.schema.hasTable('patient_device_sources')) {
    await knex.schema.dropTableIfExists('patient_device_sources');
  }
  if (await knex.schema.hasTable('step_care_rule_events')) {
    await knex.schema.dropTableIfExists('step_care_rule_events');
  }
  if (await knex.schema.hasTable('clinic_step_care_rules')) {
    await knex.schema.dropTableIfExists('clinic_step_care_rules');
  }
}
