import type { Knex } from 'knex';

/**
 * Behavioral Pathways enterprise foundation.
 *
 * Adds:
 * - patient_behavior_contracts
 * - patient_routine_plans
 * - patient_routine_events
 * - patient_behavioral_segments
 * - micro_learning_cards
 * - clinic_micro_learning_rules
 * - patient_micro_learning_assignments
 * - clinic_choice_architecture_defaults
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('patient_behavior_contracts'))) {
    await knex.schema.createTable('patient_behavior_contracts', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('pathway_id').nullable().references('id').inTable('treatment_pathways').onDelete('SET NULL');
      t.text('trigger_text').notNullable();
      t.text('commitment_behavior').notNullable();
      t.text('fallback_plan').notNullable();
      t.date('review_date').notNullable();
      t.string('accountability_partner', 240).nullable();
      t.string('adherence_status', 24).notNullable().defaultTo('on_track');
      t.text('adherence_note').nullable();
      t.timestamp('last_adherence_check_at', { useTz: true }).nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('lock_version').notNullable().defaultTo(1);
      t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('updated_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'patient_id', 'is_active'], 'idx_behavior_contracts_clinic_patient_active');
      t.index(['clinic_id', 'review_date'], 'idx_behavior_contracts_clinic_review_date');
      t.index(['patient_id'], 'idx_behavior_contracts_patient_id');
      t.index(['pathway_id'], 'idx_behavior_contracts_pathway_id');
      t.index(['created_by_staff_id'], 'idx_behavior_contracts_created_by_staff_id');
      t.index(['updated_by_staff_id'], 'idx_behavior_contracts_updated_by_staff_id');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_behavior_contracts ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_behavior_contracts_tenant ON patient_behavior_contracts
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_patient_behavior_contracts_updated_at ON patient_behavior_contracts;
      CREATE TRIGGER trg_patient_behavior_contracts_updated_at
        BEFORE UPDATE ON patient_behavior_contracts
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable('patient_routine_plans'))) {
    await knex.schema.createTable('patient_routine_plans', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('pathway_id').nullable().references('id').inTable('treatment_pathways').onDelete('SET NULL');
      t.string('name', 240).notNullable();
      t.string('condition_kind', 40).notNullable();
      t.decimal('condition_threshold', 10, 2).nullable();
      t.integer('condition_window_minutes').notNullable().defaultTo(60);
      t.string('then_action_kind', 64).notNullable();
      t.text('then_action_text').notNullable();
      t.integer('fallback_after_minutes').nullable();
      t.text('fallback_action_text').nullable();
      t.date('review_date').notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('lock_version').notNullable().defaultTo(1);
      t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.uuid('updated_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'patient_id', 'is_active'], 'idx_routine_plans_clinic_patient_active');
      t.index(['clinic_id', 'review_date'], 'idx_routine_plans_clinic_review_date');
      t.index(['patient_id'], 'idx_routine_plans_patient_id');
      t.index(['pathway_id'], 'idx_routine_plans_pathway_id');
      t.index(['created_by_staff_id'], 'idx_routine_plans_created_by_staff_id');
      t.index(['updated_by_staff_id'], 'idx_routine_plans_updated_by_staff_id');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_routine_plans ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_routine_plans_tenant ON patient_routine_plans
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_patient_routine_plans_updated_at ON patient_routine_plans;
      CREATE TRIGGER trg_patient_routine_plans_updated_at
        BEFORE UPDATE ON patient_routine_plans
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable('patient_routine_events'))) {
    await knex.schema.createTable('patient_routine_events', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('routine_id').nullable().references('id').inTable('patient_routine_plans').onDelete('SET NULL');
      t.string('event_type', 64).notNullable();
      t.decimal('value_numeric', 10, 2).nullable();
      t.string('value_text', 500).nullable();
      t.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'patient_id', 'occurred_at'], 'idx_routine_events_clinic_patient_occurred');
      t.index(['clinic_id', 'event_type', 'occurred_at'], 'idx_routine_events_clinic_type_occurred');
      t.index(['routine_id'], 'idx_routine_events_routine_id');
      t.index(['patient_id'], 'idx_routine_events_patient_id');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_routine_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_routine_events_tenant ON patient_routine_events
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
    `);
  }

  if (!(await knex.schema.hasTable('patient_behavioral_segments'))) {
    await knex.schema.createTable('patient_behavioral_segments', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('segment_code', 40).notNullable();
      t.decimal('confidence_score', 6, 4).notNullable().defaultTo(0.5);
      t.jsonb('rationale').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('override_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('override_reason').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'patient_id'], { indexName: 'uq_behavioral_segments_clinic_patient' });
      t.index(['clinic_id', 'segment_code'], 'idx_behavioral_segments_clinic_segment');
      t.index(['patient_id'], 'idx_behavioral_segments_patient_id');
      t.index(['override_by_staff_id'], 'idx_behavioral_segments_override_by_staff_id');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_behavioral_segments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_behavioral_segments_tenant ON patient_behavioral_segments
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_patient_behavioral_segments_updated_at ON patient_behavioral_segments;
      CREATE TRIGGER trg_patient_behavioral_segments_updated_at
        BEFORE UPDATE ON patient_behavioral_segments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable('micro_learning_cards'))) {
    await knex.schema.createTable('micro_learning_cards', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.string('card_key', 120).notNullable().unique();
      t.string('title', 240).notNullable();
      t.text('body').notNullable();
      t.integer('estimated_minutes').notNullable().defaultTo(5);
      t.jsonb('tags').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE micro_learning_cards ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_micro_learning_cards_open ON micro_learning_cards USING (true);
      DROP TRIGGER IF EXISTS trg_micro_learning_cards_updated_at ON micro_learning_cards;
      CREATE TRIGGER trg_micro_learning_cards_updated_at
        BEFORE UPDATE ON micro_learning_cards
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable('clinic_micro_learning_rules'))) {
    await knex.schema.createTable('clinic_micro_learning_rules', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('name', 240).notNullable();
      t.string('tracking_type', 40).notNullable();
      t.decimal('delta_threshold', 10, 2).notNullable();
      t.integer('window_days').notNullable().defaultTo(3);
      t.uuid('card_id').notNullable().references('id').inTable('micro_learning_cards').onDelete('CASCADE');
      t.integer('cooldown_days').notNullable().defaultTo(7);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('lock_version').notNullable().defaultTo(1);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'name'], { indexName: 'uq_clinic_micro_learning_rules_name' });
      t.index(['clinic_id', 'is_active'], 'idx_clinic_micro_learning_rules_active');
      t.index(['clinic_id', 'tracking_type'], 'idx_clinic_micro_learning_rules_type');
      t.index(['card_id'], 'idx_clinic_micro_learning_rules_card_id');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE clinic_micro_learning_rules ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_clinic_micro_learning_rules_tenant ON clinic_micro_learning_rules
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_clinic_micro_learning_rules_updated_at ON clinic_micro_learning_rules;
      CREATE TRIGGER trg_clinic_micro_learning_rules_updated_at
        BEFORE UPDATE ON clinic_micro_learning_rules
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable('patient_micro_learning_assignments'))) {
    await knex.schema.createTable('patient_micro_learning_assignments', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('card_id').notNullable().references('id').inTable('micro_learning_cards').onDelete('CASCADE');
      t.uuid('rule_id').nullable().references('id').inTable('clinic_micro_learning_rules').onDelete('SET NULL');
      t.string('status', 20).notNullable().defaultTo('assigned');
      t.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('opened_at', { useTz: true }).nullable();
      t.timestamp('completed_at', { useTz: true }).nullable();
      t.text('source_reason').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'patient_id', 'status'], 'idx_micro_learning_assignments_patient_status');
      t.index(['clinic_id', 'rule_id', 'assigned_at'], 'idx_micro_learning_assignments_rule_assigned');
      t.index(['patient_id'], 'idx_micro_learning_assignments_patient_id');
      t.index(['card_id'], 'idx_micro_learning_assignments_card_id');
      t.index(['rule_id'], 'idx_micro_learning_assignments_rule_id');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE patient_micro_learning_assignments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_micro_learning_assignments_tenant ON patient_micro_learning_assignments
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_patient_micro_learning_assignments_updated_at ON patient_micro_learning_assignments;
      CREATE TRIGGER trg_patient_micro_learning_assignments_updated_at
        BEFORE UPDATE ON patient_micro_learning_assignments
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }

  if (!(await knex.schema.hasTable('clinic_choice_architecture_defaults'))) {
    await knex.schema.createTable('clinic_choice_architecture_defaults', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE').unique();
      t.integer('next_review_due_days_default').notNullable().defaultTo(28);
      t.integer('safety_plan_refresh_days_default').notNullable().defaultTo(30);
      t.integer('medication_reminder_window_minutes').notNullable().defaultTo(90);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id'], 'idx_choice_arch_defaults_clinic');
    });
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      ALTER TABLE clinic_choice_architecture_defaults ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_clinic_choice_architecture_defaults_tenant ON clinic_choice_architecture_defaults
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
      DROP TRIGGER IF EXISTS trg_clinic_choice_architecture_defaults_updated_at ON clinic_choice_architecture_defaults;
      CREATE TRIGGER trg_clinic_choice_architecture_defaults_updated_at
        BEFORE UPDATE ON clinic_choice_architecture_defaults
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('clinic_choice_architecture_defaults')) {
    await knex.schema.dropTableIfExists('clinic_choice_architecture_defaults');
  }
  if (await knex.schema.hasTable('patient_micro_learning_assignments')) {
    await knex.schema.dropTableIfExists('patient_micro_learning_assignments');
  }
  if (await knex.schema.hasTable('clinic_micro_learning_rules')) {
    await knex.schema.dropTableIfExists('clinic_micro_learning_rules');
  }
  if (await knex.schema.hasTable('micro_learning_cards')) {
    await knex.schema.dropTableIfExists('micro_learning_cards');
  }
  if (await knex.schema.hasTable('patient_behavioral_segments')) {
    await knex.schema.dropTableIfExists('patient_behavioral_segments');
  }
  if (await knex.schema.hasTable('patient_routine_events')) {
    await knex.schema.dropTableIfExists('patient_routine_events');
  }
  if (await knex.schema.hasTable('patient_routine_plans')) {
    await knex.schema.dropTableIfExists('patient_routine_plans');
  }
  if (await knex.schema.hasTable('patient_behavior_contracts')) {
    await knex.schema.dropTableIfExists('patient_behavior_contracts');
  }
}
