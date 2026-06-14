import type { Knex } from 'knex';

/**
 * BUG-ARCH-SEQUENCE-RACE-CONTROL
 *
 * Introduce an atomic per-clinic sequence registry so operational
 * identifiers (patient / episode / referral / invoice numbers) no
 * longer rely on MAX()/COUNT()+1 race-prone scans.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('clinic_sequences');
  if (!exists) {
    await knex.schema.createTable('clinic_sequences', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('scope_key', 120).notNullable();
      t.bigInteger('next_value').notNullable().defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'scope_key'], { indexName: 'uq_clinic_sequences_scope' });
      t.index(['clinic_id', 'scope_key'], 'idx_clinic_sequences_scope_lookup');
    });
  }

  const constraintExists = await knex
    .select(knex.raw('1'))
    .from('pg_constraint')
    .where({ conname: 'clinic_sequences_next_value_nonnegative' })
    .first();

  if (!constraintExists) {
    // @migration-raw-exempt: check_constraint
    await knex.raw(`
      ALTER TABLE clinic_sequences
        ADD CONSTRAINT clinic_sequences_next_value_nonnegative
        CHECK (next_value >= 0)
    `);
  }

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE clinic_sequences ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_clinic_sequences_tenant ON clinic_sequences;
    CREATE POLICY rls_clinic_sequences_tenant ON clinic_sequences
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  const duplicateReferrals = await knex.raw<{ rows?: Array<{ clinic_id: string; referral_number: string; duplicate_count: number | string }> }>(`
    SELECT clinic_id, referral_number, COUNT(*)::int AS duplicate_count
    FROM referrals
    WHERE deleted_at IS NULL
    GROUP BY clinic_id, referral_number
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if ((duplicateReferrals.rows?.length ?? 0) > 0) {
    const row = duplicateReferrals.rows?.[0];
    throw new Error(
      `Cannot add unique referral number index; duplicates exist for clinic=${row?.clinic_id} referral_number=${row?.referral_number}`,
    );
  }

  const duplicateInvoices = await knex.raw<{ rows?: Array<{ clinic_id: string; invoice_number: string; duplicate_count: number | string }> }>(`
    SELECT clinic_id, invoice_number, COUNT(*)::int AS duplicate_count
    FROM invoices
    WHERE invoice_number IS NOT NULL
    GROUP BY clinic_id, invoice_number
    HAVING COUNT(*) > 1
    LIMIT 1
  `);
  if ((duplicateInvoices.rows?.length ?? 0) > 0) {
    const row = duplicateInvoices.rows?.[0];
    throw new Error(
      `Cannot add unique invoice number index; duplicates exist for clinic=${row?.clinic_id} invoice_number=${row?.invoice_number}`,
    );
  }

  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_clinic_referral_number_active
      ON referrals (clinic_id, referral_number)
      WHERE deleted_at IS NULL
  `);
  // @migration-raw-exempt: index_functional
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_clinic_invoice_number
      ON invoices (clinic_id, invoice_number)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_functional
  await knex.raw('DROP INDEX IF EXISTS uq_invoices_clinic_invoice_number');
  // @migration-raw-exempt: index_partial
  await knex.raw('DROP INDEX IF EXISTS uq_referrals_clinic_referral_number_active');
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_clinic_sequences_tenant ON clinic_sequences');
  await knex.schema.dropTableIfExists('clinic_sequences');
}
