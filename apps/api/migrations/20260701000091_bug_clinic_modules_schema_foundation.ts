import type { Knex } from 'knex';

/**
 * BUG-CLINIC-MODULES-SCHEMA-FOUNDATION
 *
 * Canonicalize clinic_modules as migration-owned schema.
 * Prior revisions created this table at runtime in request/provisioning paths.
 */

const TABLE = 'clinic_modules';
const UNIQUE_CONSTRAINT = 'uq_clinic_modules_clinic_module';
const CLINIC_FK = 'fk_clinic_modules_clinic_id';
const CLINIC_INDEX = 'idx_clinic_modules_clinic_id';
const TENANT_POLICY = 'rls_clinic_modules_tenant';

async function constraintExists(knex: Knex, name: string): Promise<boolean> {
  // @migration-raw-exempt: introspection
  const result = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ? LIMIT 1', [name]);
  return result.rows.length > 0;
}

async function policyExists(knex: Knex, tableName: string, policyName: string): Promise<boolean> {
  // @migration-raw-exempt: introspection
  const result = await knex.raw(
    `SELECT 1
       FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ?
        AND policyname = ?
      LIMIT 1`,
    [tableName, policyName],
  );
  return result.rows.length > 0;
}

async function indexExists(knex: Knex, indexName: string): Promise<boolean> {
  // @migration-raw-exempt: introspection
  const result = await knex.raw(
    `SELECT 1
       FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ?
      LIMIT 1`,
    [indexName],
  );
  return result.rows.length > 0;
}

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) {
    await knex.schema.createTable(TABLE, (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('module_key', 100).notNullable();
      t.boolean('is_enabled').notNullable().defaultTo(true);
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'module_key'], { indexName: UNIQUE_CONSTRAINT });
      t.index(['clinic_id'], CLINIC_INDEX);
    });
  }

  await knex.schema.alterTable(TABLE, (t) => {
    // Normalize defaults for pre-existing runtime-created tables without
    // altering the primary-key type or nullability.
    t.uuid('id').defaultTo(knex.raw('gen_random_uuid()')).alter({
      alterNullable: false,
      alterType: false,
    });
    t.boolean('is_enabled').notNullable().defaultTo(true).alter();
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()).alter();
  });

  if (!(await constraintExists(knex, UNIQUE_CONSTRAINT))) {
    // @migration-raw-exempt: idempotency_guard
    await knex.raw(
      `ALTER TABLE ${TABLE}
         ADD CONSTRAINT ${UNIQUE_CONSTRAINT}
         UNIQUE (clinic_id, module_key)`,
    );
  }

  if (!(await constraintExists(knex, CLINIC_FK))) {
    // @migration-raw-exempt: idempotency_guard
    await knex.raw(
      `ALTER TABLE ${TABLE}
         ADD CONSTRAINT ${CLINIC_FK}
         FOREIGN KEY (clinic_id) REFERENCES clinics(id) ON DELETE CASCADE`,
    );
  }

  if (!(await indexExists(knex, CLINIC_INDEX))) {
    await knex.schema.alterTable(TABLE, (t) => {
      t.index(['clinic_id'], CLINIC_INDEX);
    });
  }

  // @migration-raw-exempt: rls_policy
  await knex.raw(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`);
  if (!(await policyExists(knex, TABLE, TENANT_POLICY))) {
    // @migration-raw-exempt: rls_policy
    await knex.raw(`
      CREATE POLICY ${TENANT_POLICY} ON ${TABLE}
        FOR ALL
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
    `);
  }

  // @migration-raw-exempt: rls_policy
  await knex.raw(`ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`);
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  // Conservative rollback: keep table/data, remove policy enforcement.
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw(`DROP POLICY IF EXISTS ${TENANT_POLICY} ON ${TABLE}`);
  // @migration-raw-exempt: rls_policy
  await knex.raw(`ALTER TABLE ${TABLE} NO FORCE ROW LEVEL SECURITY`);
}
