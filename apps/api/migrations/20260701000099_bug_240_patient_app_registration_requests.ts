import type { Knex } from 'knex';

/**
 * BUG-240: Patient-app self-registration intake requests.
 *
 * Public Viva registration must not create live patients or accounts. It
 * records a clinic-scoped pending request for staff review; activation remains
 * invitation based.
 */
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('patient_app_registration_requests')) return;

  await knex.schema.createTable('patient_app_registration_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.string('dedupe_key', 128).notNullable();
    t.string('given_name', 512).notNullable();
    t.string('family_name', 512).notNullable();
    t.string('preferred_name', 512).nullable();
    t.string('date_of_birth', 512).notNullable();
    t.string('gender', 512).nullable();
    t.string('phone_mobile', 512).notNullable();
    t.string('email', 512).nullable();
    t.jsonb('address').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.jsonb('next_of_kin').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.jsonb('gp').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.jsonb('support_person').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.text('reason').nullable();
    t.string('source', 60).notNullable().defaultTo('viva_patient_app');
    t.string('status', 30).notNullable().defaultTo('pending');
    t.uuid('reviewed_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.uuid('duplicate_patient_id').nullable().references('id').inTable('patients').onDelete('SET NULL');
    t.string('client_request_id', 128).nullable();
    t.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    t.integer('lock_version').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id', 'status', 'created_at'], 'idx_patient_app_reg_requests_clinic_status_created');
    t.index(['clinic_id', 'dedupe_key'], 'idx_patient_app_reg_requests_clinic_dedupe');
    t.index(['reviewed_by_staff_id'], 'idx_patient_app_reg_requests_reviewed_by_staff_id');
    t.index(['duplicate_patient_id'], 'idx_patient_app_reg_requests_duplicate_patient_id');
  });

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX uq_patient_app_reg_requests_pending_dedupe
      ON patient_app_registration_requests (clinic_id, dedupe_key)
      WHERE deleted_at IS NULL AND status = 'pending';
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE patient_app_registration_requests
      ADD CONSTRAINT patient_app_registration_requests_status_check
      CHECK (status IN ('pending', 'accepted', 'rejected', 'duplicate', 'withdrawn'));
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE patient_app_registration_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE patient_app_registration_requests FORCE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_app_registration_requests_tenant
      ON patient_app_registration_requests
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_patient_app_registration_requests_updated_at
      ON patient_app_registration_requests;
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_patient_app_registration_requests_updated_at
      BEFORE UPDATE ON patient_app_registration_requests
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    DROP INDEX IF EXISTS uq_patient_app_reg_requests_pending_dedupe;
  `);

  // @migration-raw-exempt: trigger_drop
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_patient_app_registration_requests_updated_at
      ON patient_app_registration_requests;
  `);
  await knex.schema.dropTableIfExists('patient_app_registration_requests');
}
