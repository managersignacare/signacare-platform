import { Knex } from 'knex';

/**
 * Audit Tier 16 — Letter Phase 2: delivery, exports, translations,
 * post-approval revisions, letterhead config.
 *
 * Tier 15 shipped the authoring lifecycle (draft → approved). Tier 16
 * adds what happens AFTER approval:
 *
 *   1. letter_deliveries (16.1) — one row per send attempt per
 *      channel. Channel enum: healthlink, mhr_docref, email,
 *      fax, print, secure_link. status: queued / in_flight /
 *      delivered / failed. Includes receipt_id (channel-specific
 *      tracking ID) + attempted_at + delivered_at + error.
 *
 *   2. letter_exports (16.2) — rendered export artefacts. format enum:
 *      pdf, cda_document, fhir_composition, plain_text. content_ref
 *      points at the blob-storage URL; generated_by + generated_at
 *      give the provenance chain.
 *
 *   3. letter_translations (16.3) — non-English renderings. language
 *      codes follow ISO 639-1 (two-letter). translator_model tells us
 *      which model produced the translation (model-version-locked
 *      per Tier 19).
 *
 *   4. letter_revisions (16.4) — post-approval edit audit. When an
 *      approved letter is re-opened (status flips to 'revised'), a
 *      revision row captures the before-text + reason + requested_by
 *      so the medico-legal chain is preserved.
 *
 *   5. clinic_settings.letterhead_html (16.5) — HTML fragment
 *      (logo + address block) that the PDF renderer prepends to
 *      every letter. Tenant-scoped; nullable so clinics without
 *      branding set up still get a plain PDF.
 *
 * RLS + indexes + CHECK per §6.3 / §7.1 / §12.4.
 */
export async function up(knex: Knex): Promise<void> {
  // 16.1 — letter_deliveries
  await knex.schema.createTable('letter_deliveries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.string('channel', 30).notNullable();
    t.string('recipient_name', 300).notNullable();
    t.string('recipient_address', 500).nullable();
    t.string('recipient_email', 200).nullable();
    t.string('recipient_fax', 30).nullable();
    t.string('recipient_mhr_ihi', 20).nullable();
    t.string('status', 20).notNullable().defaultTo('queued');
    t.string('receipt_id', 200).nullable();
    t.uuid('sent_by').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('attempted_at', { useTz: true }).nullable();
    t.timestamp('delivered_at', { useTz: true }).nullable();
    t.text('error').nullable();
    t.integer('attempt_count').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['letter_id']);
    t.index(['clinic_id', 'status', 'channel'], 'idx_letter_deliveries_queue');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_deliveries
      ADD CONSTRAINT letter_deliveries_channel_check
      CHECK (channel IN ('healthlink','mhr_docref','email','fax','print','secure_link'))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_deliveries
      ADD CONSTRAINT letter_deliveries_status_check
      CHECK (status IN ('queued','in_flight','delivered','failed','cancelled'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_deliveries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_deliveries_tenant ON letter_deliveries
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 16.2 — letter_exports
  await knex.schema.createTable('letter_exports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.string('format', 30).notNullable();
    t.string('content_ref', 500).notNullable();
    t.integer('content_size_bytes').nullable();
    t.uuid('generated_by').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['clinic_id']);
    t.index(['letter_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_exports
      ADD CONSTRAINT letter_exports_format_check
      CHECK (format IN ('pdf','cda_document','fhir_composition','plain_text'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_exports ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_exports_tenant ON letter_exports
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 16.3 — letter_translations
  await knex.schema.createTable('letter_translations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.string('language_code', 5).notNullable();
    t.text('translated_text').notNullable();
    t.string('translator_model', 100).notNullable();
    t.uuid('translated_by').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('translated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['letter_id', 'language_code']);
    t.index(['clinic_id']);
  });

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_translations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_translations_tenant ON letter_translations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 16.4 — letter_revisions. Post-approval edits capture the
  // pre-edit text + reason so the medico-legal audit trail includes
  // the rationale for any change after approval.
  await knex.schema.createTable('letter_revisions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('letter_id').notNullable().references('id').inTable('letters').onDelete('CASCADE');
    t.integer('revision_number').notNullable();
    t.text('previous_rendered_text').nullable();
    t.string('reason_category', 40).notNullable();
    t.text('reason_detail').notNullable();
    t.uuid('requested_by').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['letter_id', 'revision_number']);
    t.index(['clinic_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE letter_revisions
      ADD CONSTRAINT letter_revisions_reason_category_check
      CHECK (reason_category IN (
        'factual_correction','typo','recipient_change',
        'patient_request','clinical_update','legal_correction','other'
      ))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE letter_revisions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_letter_revisions_tenant ON letter_revisions
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  // 16.5 — clinic_settings.letterhead_html. Nullable HTML fragment
  // prepended to every PDF. Admin edits via Power Settings.
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.text('letterhead_html').nullable();
    t.string('letterhead_logo_url', 500).nullable();
    t.string('default_letter_language', 5).notNullable().defaultTo('en');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('default_letter_language');
    t.dropColumn('letterhead_logo_url');
    t.dropColumn('letterhead_html');
  });

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_revisions_tenant ON letter_revisions');
  await knex.schema.dropTableIfExists('letter_revisions');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_translations_tenant ON letter_translations');
  await knex.schema.dropTableIfExists('letter_translations');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_exports_tenant ON letter_exports');
  await knex.schema.dropTableIfExists('letter_exports');

  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_letter_deliveries_tenant ON letter_deliveries');
  await knex.schema.dropTableIfExists('letter_deliveries');
}
