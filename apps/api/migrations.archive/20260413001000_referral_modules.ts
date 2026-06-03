// 20260413001000_referral_modules.ts
// Adds Solo & Team referral management module support:
//   - New columns on `referrals` for mode, distribution, and scheduling
//   - `referral_clinician_offers` table for team-mode offer tracking
//   - `referral_feedback_log` table for referrer communication audit
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── 1. ALTER referrals — add module columns ──────────────────────────────
  const hasReferralMode = await knex.schema.hasColumn('referrals', 'referral_mode');
  if (!hasReferralMode) {
    await knex.schema.alterTable('referrals', (t) => {
      // Mode: standard (legacy), solo, team — immutable after creation
      t.string('referral_mode', 20).notNullable().defaultTo('standard');

      // Team-mode distribution
      t.uuid('target_clinician_id')
        .nullable()
        .references('id')
        .inTable('staff')
        .onDelete('SET NULL');
      t.string('distribution_mode', 30).nullable(); // specific_clinician, specialty, all
      t.string('distribution_speciality', 100).nullable();

      // Acceptance tracking
      t.uuid('accepted_by_staff_id')
        .nullable()
        .references('id')
        .inTable('staff')
        .onDelete('SET NULL');

      // Broadcast & reminder scheduling (team mode)
      t.timestamp('broadcast_at', { useTz: true }).nullable();
      t.timestamp('reminder_sent_at', { useTz: true }).nullable();
      t.timestamp('final_reminder_sent_at', { useTz: true }).nullable();
      t.timestamp('auto_close_at', { useTz: true }).nullable();

      // Referrer feedback
      t.timestamp('feedback_sent_at', { useTz: true }).nullable();

      // Clarification from referrer / patient
      t.text('clarification_notes').nullable();

      // Who entered this referral (front desk tracking for reminders)
      t.uuid('created_by_staff_id')
        .nullable()
        .references('id')
        .inTable('staff')
        .onDelete('SET NULL');

      // Indexes for module-specific queries
      t.index(['clinic_id', 'referral_mode', 'status'], 'idx_referrals_mode_status');
      t.index(['clinic_id', 'target_clinician_id'], 'idx_referrals_target_clinician');
      t.index(['clinic_id', 'auto_close_at'], 'idx_referrals_auto_close');
    });
  }

  // ── 2. referral_clinician_offers ─────────────────────────────────────────
  if (!(await knex.schema.hasTable('referral_clinician_offers'))) {
    await knex.schema.createTable('referral_clinician_offers', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      t.uuid('clinic_id')
        .notNullable()
        .references('id')
        .inTable('clinics')
        .onDelete('RESTRICT');

      t.uuid('referral_id')
        .notNullable()
        .references('id')
        .inTable('referrals')
        .onDelete('CASCADE');

      t.uuid('staff_id')
        .notNullable()
        .references('id')
        .inTable('staff')
        .onDelete('CASCADE');

      t.timestamp('offered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.string('response', 20).notNullable().defaultTo('pending'); // pending, accepted, declined, expired
      t.timestamp('responded_at', { useTz: true }).nullable();
      t.text('decline_reason').nullable();

      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      // One offer per clinician per referral — also prevents race-condition duplicates
      t.unique(['referral_id', 'staff_id'], { indexName: 'uq_offer_referral_staff' });
      t.index(['clinic_id', 'referral_id'], 'idx_offers_clinic_referral');
      t.index(['clinic_id', 'staff_id', 'response'], 'idx_offers_staff_response');
    });

    // RLS
    await knex.raw(`
      ALTER TABLE referral_clinician_offers ENABLE ROW LEVEL SECURITY;
    `);
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE tablename = 'referral_clinician_offers'
            AND policyname = 'rls_referral_clinician_offers_tenant'
        ) THEN
          CREATE POLICY rls_referral_clinician_offers_tenant
            ON referral_clinician_offers FOR ALL
            USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
            WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
        END IF;
      END $$;
    `);
  }

  // ── 3. referral_feedback_log ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('referral_feedback_log'))) {
    await knex.schema.createTable('referral_feedback_log', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      t.uuid('clinic_id')
        .notNullable()
        .references('id')
        .inTable('clinics')
        .onDelete('RESTRICT');

      t.uuid('referral_id')
        .notNullable()
        .references('id')
        .inTable('referrals')
        .onDelete('CASCADE');

      // accepted, rejected, closed_no_response, clarification_request, appointment_booked
      t.string('feedback_type', 30).notNullable();

      t.string('recipient_email', 255).notNullable();
      t.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.text('message_body').nullable();

      t.uuid('sent_by_staff_id')
        .nullable()
        .references('id')
        .inTable('staff')
        .onDelete('SET NULL');

      // queued, sent, failed, letter_generated
      t.string('delivery_status', 20).notNullable().defaultTo('queued');

      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'referral_id'], 'idx_feedback_log_clinic_referral');
    });

    // RLS
    await knex.raw(`
      ALTER TABLE referral_feedback_log ENABLE ROW LEVEL SECURITY;
    `);
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE tablename = 'referral_feedback_log'
            AND policyname = 'rls_referral_feedback_log_tenant'
        ) THEN
          CREATE POLICY rls_referral_feedback_log_tenant
            ON referral_feedback_log FOR ALL
            USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
            WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
        END IF;
      END $$;
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop new tables
  await knex.schema.dropTableIfExists('referral_feedback_log');
  await knex.schema.dropTableIfExists('referral_clinician_offers');

  // Remove added columns from referrals
  const hasReferralMode = await knex.schema.hasColumn('referrals', 'referral_mode');
  if (hasReferralMode) {
    await knex.schema.alterTable('referrals', (t) => {
      t.dropIndex([], 'idx_referrals_mode_status');
      t.dropIndex([], 'idx_referrals_target_clinician');
      t.dropIndex([], 'idx_referrals_auto_close');

      t.dropColumn('referral_mode');
      t.dropColumn('target_clinician_id');
      t.dropColumn('distribution_mode');
      t.dropColumn('distribution_speciality');
      t.dropColumn('accepted_by_staff_id');
      t.dropColumn('broadcast_at');
      t.dropColumn('reminder_sent_at');
      t.dropColumn('final_reminder_sent_at');
      t.dropColumn('auto_close_at');
      t.dropColumn('feedback_sent_at');
      t.dropColumn('clarification_notes');
      t.dropColumn('created_by_staff_id');
    });
  }
}
