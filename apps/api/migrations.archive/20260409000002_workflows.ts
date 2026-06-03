import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── workflows: configurable business process definitions ────────────────────
  if (!(await knex.schema.hasTable('workflows'))) {
    await knex.schema.createTable('workflows', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('name', 200).notNullable();
      t.text('description').nullable();
      t.string('trigger_event', 100).notNullable();
      // trigger_event: referral_accepted, episode_opened, episode_closed, note_signed,
      //   task_completed, appointment_completed, patient_admitted, patient_discharged,
      //   pathology_uploaded, lai_overdue, clozapine_blood_due, review_overdue
      t.jsonb('steps').notNullable().defaultTo('[]');
      // steps: [{ order: 1, type: 'create_task', params: { title, assigneeRole, priority, dueDays } }, ...]
      // step types: create_episode, assign_team, create_task, send_notification, update_status,
      //   create_note, wait_duration, create_alert
      t.boolean('is_active').notNullable().defaultTo(true);
      t.uuid('created_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
      t.index(['clinic_id', 'trigger_event', 'is_active']);
    });

    await knex.raw('ALTER TABLE workflows ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_workflows_tenant ON workflows
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }

  // ── workflow_executions: audit log of workflow runs ─────────────────────────
  if (!(await knex.schema.hasTable('workflow_executions'))) {
    await knex.schema.createTable('workflow_executions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('workflow_id').notNullable().references('id').inTable('workflows').onDelete('CASCADE');
      t.jsonb('trigger_data').nullable(); // { patientId, referralId, etc. }
      t.string('status', 30).notNullable().defaultTo('running'); // running, completed, failed
      t.integer('steps_completed').notNullable().defaultTo(0);
      t.integer('total_steps').notNullable().defaultTo(0);
      t.text('error_message').nullable();
      t.jsonb('step_results').nullable(); // Array of per-step results
      t.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('completed_at', { useTz: true }).nullable();
      t.index(['clinic_id', 'workflow_id']);
      t.index(['clinic_id', 'status']);
    });

    await knex.raw('ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_workflow_executions_tenant ON workflow_executions
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('workflow_executions');
  await knex.schema.dropTableIfExists('workflows');
}
