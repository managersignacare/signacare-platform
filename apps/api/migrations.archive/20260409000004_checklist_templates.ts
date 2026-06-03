import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── checklist_templates: configurable checklist definitions ─────────────────
  if (!(await knex.schema.hasTable('checklist_templates'))) {
    await knex.schema.createTable('checklist_templates', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.text('description').nullable();
      t.string('trigger_point', 50).notNullable(); // discharge, 91_day_review, admission, pre_ect, clozapine_initiation, restrictive_intervention, custom
      t.string('enforcement', 20).notNullable().defaultTo('advisory'); // mandatory, advisory
      t.jsonb('items').notNullable().defaultTo('[]');
      // items: [{ id, section, label, required, helpText }]
      t.boolean('is_active').notNullable().defaultTo(true);
      t.integer('sort_order').notNullable().defaultTo(0);
      t.uuid('created_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'trigger_point', 'is_active']);
    });

    await knex.raw('ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_checklist_templates_tenant ON checklist_templates
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }

  // ── checklist_instances: completed checklist records per patient/episode ────
  if (!(await knex.schema.hasTable('checklist_instances'))) {
    await knex.schema.createTable('checklist_instances', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('template_id').notNullable().references('id').inTable('checklist_templates').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('completed_by_staff_id').nullable();
      t.string('status', 20).notNullable().defaultTo('in_progress'); // in_progress, completed, skipped
      t.jsonb('checked_items').notNullable().defaultTo('{}'); // { itemId: { checked: boolean, note?: string, checkedAt?: string, checkedBy?: string } }
      t.integer('total_items').notNullable().defaultTo(0);
      t.integer('completed_items').notNullable().defaultTo(0);
      t.text('notes').nullable();
      t.timestamp('completed_at', { useTz: true }).nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'template_id']);
      t.index(['clinic_id', 'episode_id']);
    });

    await knex.raw('ALTER TABLE checklist_instances ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_checklist_instances_tenant ON checklist_instances
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('checklist_instances');
  await knex.schema.dropTableIfExists('checklist_templates');
}
