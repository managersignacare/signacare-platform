import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('admission_waitlist'))) {
    await knex.schema.createTable('admission_waitlist', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('hotspot_id').nullable(); // links to hotspot if flagged from hotspot
      t.string('source', 30).notNullable().defaultTo('planned'); // 'hotspot' or 'planned'
      t.string('priority', 20).notNullable().defaultTo('medium').checkIn(['low', 'medium', 'high', 'urgent']);
      t.string('status', 30).notNullable().defaultTo('waiting').checkIn(['waiting', 'admitted', 'removed', 'cancelled']);
      t.text('reason').nullable();
      t.text('clinical_notes').nullable();
      t.string('preferred_ward', 100).nullable();
      t.date('target_admission_date').nullable();
      t.uuid('flagged_by_staff_id').nullable();
      t.uuid('removed_by_staff_id').nullable();
      t.timestamp('removed_at', { useTz: true }).nullable();
      t.text('removal_reason').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'status']);
      t.index(['clinic_id', 'patient_id']);
    });

    await knex.raw('ALTER TABLE admission_waitlist ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_admission_waitlist_tenant ON admission_waitlist
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('admission_waitlist');
}
