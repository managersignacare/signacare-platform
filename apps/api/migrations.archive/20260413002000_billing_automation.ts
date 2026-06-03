// 20260413002000_billing_automation.ts
// Billing automation: fee schedules, clinician fee overrides, invoice workflow,
// referral validity tracking, billing queue.
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── 1. fee_schedules — MBS/DVA/NDIS/custom items per org ────────────────
  if (!(await knex.schema.hasTable('fee_schedules'))) {
    await knex.schema.createTable('fee_schedules', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.string('item_number', 20).notNullable();
      t.string('description', 500).notNullable();
      t.integer('schedule_fee_cents').notNullable();
      t.string('category', 50).notNullable(); // psychiatry_initial, psychiatry_subsequent, telehealth_phone, telehealth_video, group_therapy, ect, case_conference, other
      t.string('modality', 30).nullable(); // in_rooms, phone, video, group
      t.integer('min_duration_mins').nullable();
      t.integer('max_duration_mins').nullable();
      t.boolean('is_initial').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.string('source', 20).notNullable().defaultTo('mbs'); // mbs, dva, ndis, custom
      t.date('effective_from').nullable();
      t.date('effective_to').nullable();
      t.integer('sort_order').defaultTo(0);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['clinic_id', 'item_number', 'source', 'effective_from'], { indexName: 'uq_fee_schedule_item' });
      t.index(['clinic_id', 'category'], 'idx_fee_schedules_category');
      t.index(['clinic_id', 'is_active'], 'idx_fee_schedules_active');
    });

    await knex.raw(`ALTER TABLE fee_schedules ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='fee_schedules' AND policyname='rls_fee_schedules_tenant') THEN
          CREATE POLICY rls_fee_schedules_tenant ON fee_schedules FOR ALL
            USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
            WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
        END IF;
      END $$;
    `);
  }

  // ── 2. clinician_fee_overrides — per-clinician gap/fee config ───────────
  if (!(await knex.schema.hasTable('clinician_fee_overrides'))) {
    await knex.schema.createTable('clinician_fee_overrides', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.string('item_number', 20).notNullable();
      t.integer('provider_fee_cents').notNullable();
      t.integer('gap_cents').notNullable().defaultTo(0);
      t.boolean('bulk_bill_eligible').notNullable().defaultTo(false);
      t.text('notes').nullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.unique(['clinic_id', 'staff_id', 'item_number'], { indexName: 'uq_clinician_fee_override' });
      t.index(['clinic_id', 'staff_id'], 'idx_clinician_fees_staff');
    });

    await knex.raw(`ALTER TABLE clinician_fee_overrides ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clinician_fee_overrides' AND policyname='rls_clinician_fee_overrides_tenant') THEN
          CREATE POLICY rls_clinician_fee_overrides_tenant ON clinician_fee_overrides FOR ALL
            USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
            WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
        END IF;
      END $$;
    `);
  }

  // ── 3. referral_validity — GP/specialist referral tracking ──────────────
  if (!(await knex.schema.hasTable('referral_validity'))) {
    await knex.schema.createTable('referral_validity', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('referring_provider_name', 200).notNullable();
      t.string('referring_provider_number', 30).nullable();
      t.string('referral_type', 20).notNullable().defaultTo('gp'); // gp = 12 months, specialist = 3 months
      t.date('referral_date').notNullable();
      t.date('expiry_date').notNullable(); // computed: gp +12mo, specialist +3mo
      t.boolean('is_active').notNullable().defaultTo(true);
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'patient_id', 'is_active'], 'idx_referral_validity_patient');
    });

    await knex.raw(`ALTER TABLE referral_validity ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='referral_validity' AND policyname='rls_referral_validity_tenant') THEN
          CREATE POLICY rls_referral_validity_tenant ON referral_validity FOR ALL
            USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
            WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
        END IF;
      END $$;
    `);
  }

  // ── 4. billing_queue — batch claim submission queue ─────────────────────
  if (!(await knex.schema.hasTable('billing_queue'))) {
    await knex.schema.createTable('billing_queue', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
      t.string('claim_type', 20).notNullable(); // bulk_bill, patient_claim, dva
      t.string('status', 20).notNullable().defaultTo('queued'); // queued, submitted, accepted, rejected, error
      t.timestamp('submitted_at', { useTz: true }).nullable();
      t.string('response_code', 50).nullable();
      t.text('response_message').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'status'], 'idx_billing_queue_status');
    });

    await knex.raw(`ALTER TABLE billing_queue ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='billing_queue' AND policyname='rls_billing_queue_tenant') THEN
          CREATE POLICY rls_billing_queue_tenant ON billing_queue FOR ALL
            USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
            WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
        END IF;
      END $$;
    `);
  }

  // ── 5. ALTER billing_accounts — add missing columns ─────────────────────
  //
  // Per-column idempotency guard. An earlier migration already added
  // billing_accounts.updated_at in some environments, so guarding on
  // the single billing_type column was insufficient — the whole
  // alterTable would fail with 42701 "column already exists". Hoist
  // the existence checks and only add columns we actually need.
  const baCols = await Promise.all([
    knex.schema.hasColumn('billing_accounts', 'billing_type'),
    knex.schema.hasColumn('billing_accounts', 'health_fund_name'),
    knex.schema.hasColumn('billing_accounts', 'health_fund_member_number'),
    knex.schema.hasColumn('billing_accounts', 'ndis_number'),
    knex.schema.hasColumn('billing_accounts', 'ndis_package_manager'),
    knex.schema.hasColumn('billing_accounts', 'dva_card_type'),
    knex.schema.hasColumn('billing_accounts', 'notes'),
    knex.schema.hasColumn('billing_accounts', 'updated_at'),
  ]);
  const [
    hasBillingType,
    hasHealthFundName,
    hasHealthFundMemberNumber,
    hasNdisNumber,
    hasNdisPackageManager,
    hasDvaCardType,
    hasNotes,
    hasUpdatedAt,
  ] = baCols;
  if (baCols.some((c) => !c)) {
    await knex.schema.alterTable('billing_accounts', (t) => {
      if (!hasBillingType) t.string('billing_type', 30).nullable(); // private, bulk_bill, dva, ndis
      if (!hasHealthFundName) t.string('health_fund_name', 100).nullable();
      if (!hasHealthFundMemberNumber) t.string('health_fund_member_number', 50).nullable();
      if (!hasNdisNumber) t.string('ndis_number', 30).nullable();
      if (!hasNdisPackageManager) t.string('ndis_package_manager', 200).nullable();
      if (!hasDvaCardType) t.string('dva_card_type', 10).nullable(); // gold, white, orange
      if (!hasNotes) t.text('notes').nullable();
      if (!hasUpdatedAt) t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  // ── 6. ALTER invoices — add workflow + financial columns ────────────────
  if (!(await knex.schema.hasColumn('invoices', 'billing_type'))) {
    await knex.schema.alterTable('invoices', (t) => {
      t.uuid('appointment_id').nullable().references('id').inTable('appointments').onDelete('SET NULL');
      t.string('billing_type', 30).nullable();
      t.integer('subtotal_cents').defaultTo(0);
      t.integer('gst_cents').defaultTo(0);
      t.integer('total_cents').defaultTo(0);
      t.integer('paid_cents').defaultTo(0);
      t.integer('gap_cents').defaultTo(0);
      t.integer('schedule_fee_cents').defaultTo(0);
      t.integer('rebate_cents').defaultTo(0);
      t.integer('provider_fee_cents').defaultTo(0);
      t.date('due_date').nullable();
      t.timestamp('approved_at', { useTz: true }).nullable();
      t.uuid('approved_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('sent_at', { useTz: true }).nullable();
      t.boolean('auto_generated').notNullable().defaultTo(false);
      t.text('override_notes').nullable();
      t.boolean('referral_valid').defaultTo(true);

      t.index(['clinic_id', 'appointment_id'], 'idx_invoices_appointment');
      t.index(['clinic_id', 'billing_type', 'status'], 'idx_invoices_billing_type');
    });
  }

  // ── 7. ALTER invoice_line_items — add financial columns ─────────────────
  if (!(await knex.schema.hasColumn('invoice_line_items', 'unit_price_cents'))) {
    await knex.schema.alterTable('invoice_line_items', (t) => {
      t.integer('unit_price_cents').defaultTo(0);
      t.integer('discount_cents').defaultTo(0);
      t.integer('line_total_cents').defaultTo(0);
      t.integer('schedule_fee_cents').defaultTo(0);
    });
  }

  // ── 8. ALTER payments — add missing columns ─────────────────────────────
  //
  // Same per-column guard as billing_accounts: payments.updated_at was
  // added by an earlier migration in some environments.
  const payCols = await Promise.all([
    knex.schema.hasColumn('payments', 'received_by_id'),
    knex.schema.hasColumn('payments', 'payment_date'),
    knex.schema.hasColumn('payments', 'claim_status'),
    knex.schema.hasColumn('payments', 'claim_reference'),
    knex.schema.hasColumn('payments', 'notes'),
    knex.schema.hasColumn('payments', 'updated_at'),
  ]);
  const [
    hasReceivedBy,
    hasPaymentDate,
    hasClaimStatus,
    hasClaimReference,
    hasPayNotes,
    hasPayUpdatedAt,
  ] = payCols;
  if (payCols.some((c) => !c)) {
    await knex.schema.alterTable('payments', (t) => {
      if (!hasReceivedBy) t.uuid('received_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      if (!hasPaymentDate) t.date('payment_date').nullable();
      if (!hasClaimStatus) t.string('claim_status', 30).defaultTo('not_submitted');
      if (!hasClaimReference) t.string('claim_reference', 100).nullable();
      if (!hasPayNotes) t.text('notes').nullable();
      if (!hasPayUpdatedAt) t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('billing_queue');
  await knex.schema.dropTableIfExists('referral_validity');
  await knex.schema.dropTableIfExists('clinician_fee_overrides');
  await knex.schema.dropTableIfExists('fee_schedules');

  // Revert ALTER columns (drop added columns)
  const invoiceCols = ['appointment_id', 'billing_type', 'subtotal_cents', 'gst_cents', 'total_cents', 'paid_cents', 'gap_cents', 'schedule_fee_cents', 'rebate_cents', 'provider_fee_cents', 'due_date', 'approved_at', 'approved_by_staff_id', 'sent_at', 'auto_generated', 'override_notes', 'referral_valid'];
  for (const col of invoiceCols) {
    if (await knex.schema.hasColumn('invoices', col)) {
      await knex.schema.alterTable('invoices', (t) => t.dropColumn(col));
    }
  }

  const lineItemCols = ['unit_price_cents', 'discount_cents', 'line_total_cents', 'schedule_fee_cents'];
  for (const col of lineItemCols) {
    if (await knex.schema.hasColumn('invoice_line_items', col)) {
      await knex.schema.alterTable('invoice_line_items', (t) => t.dropColumn(col));
    }
  }

  const paymentCols = ['received_by_id', 'payment_date', 'claim_status', 'claim_reference', 'notes', 'updated_at'];
  for (const col of paymentCols) {
    if (await knex.schema.hasColumn('payments', col)) {
      await knex.schema.alterTable('payments', (t) => t.dropColumn(col));
    }
  }

  const accountCols = ['billing_type', 'health_fund_name', 'health_fund_member_number', 'ndis_number', 'ndis_package_manager', 'dva_card_type', 'notes', 'updated_at'];
  for (const col of accountCols) {
    if (await knex.schema.hasColumn('billing_accounts', col)) {
      await knex.schema.alterTable('billing_accounts', (t) => t.dropColumn(col));
    }
  }
}
