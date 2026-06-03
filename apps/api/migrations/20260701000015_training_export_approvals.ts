import { Knex } from 'knex';

/**
 * Audit Tier 5.9 (MED-G4) — training-export two-person approval.
 *
 * Before: `GET /api/v1/llm/training/export` was gated by a single
 * `requireRoles(['admin'])` check. Any compromised admin session
 * could exfiltrate the clinic's entire training corpus (de-
 * identified, but still clinically specific) in one request.
 *
 * Fix: split the export path into a 2-step approval flow.
 *
 *   1. POST /llm/training/export-requests
 *      — requester (admin) opens a pending row with reason + format
 *   2. PATCH /llm/training/export-requests/:id  { decision: 'approve' | 'reject' }
 *      — a DIFFERENT admin approves / rejects. Approval generates a
 *        one-time-use `download_token` (UUID) stored on the row.
 *   3. GET /llm/training/export?token=<token>
 *      — streams the JSONL/CSV and marks the token used. Token can
 *        only be used once; subsequent requests 410 GONE.
 *   4. audit_log row written on every transition (request / approve /
 *      reject / download) with requester + approver + row_count.
 *
 * Schema:
 *   id uuid PK
 *   clinic_id uuid FK clinics — NOT NULL (training exports are
 *     clinic-scoped)
 *   requested_by_id uuid FK staff NOT NULL
 *   requested_at timestamptz NOT NULL
 *   approved_by_id uuid FK staff NULLABLE
 *   approved_at timestamptz NULLABLE
 *   status text ('pending','approved','rejected','downloaded','expired')
 *   format text ('alpaca','chatml')
 *   reason text — requester's justification
 *   rejection_reason text NULLABLE
 *   download_token uuid NULLABLE — single-use
 *   downloaded_at timestamptz NULLABLE
 *   row_count int NULLABLE — populated on download for audit
 *   expires_at timestamptz NOT NULL — approvals expire after 24h
 *   created_at timestamptz
 *
 * Index on (clinic_id, status) for pending-list UI + (download_token)
 * unique for fast token lookup.
 *
 * RLS: clinic-scoped.
 * Append-only per §G6.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('training_export_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id')
      .notNullable()
      .references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('requested_by_id')
      .notNullable()
      .references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('approved_by_id')
      .nullable()
      .references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.string('format', 20).notNullable().defaultTo('alpaca');
    t.text('reason').nullable();
    t.text('rejection_reason').nullable();
    t.uuid('download_token').nullable().unique();
    t.timestamp('downloaded_at', { useTz: true }).nullable();
    t.integer('row_count').nullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // §7.1 — indexed FKs + admin pending-list lookup.
    t.index(['clinic_id']);
    t.index(['requested_by_id']);
    t.index(['approved_by_id']);
    t.index(['clinic_id', 'status'], 'idx_training_export_requests_clinic_status');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE training_export_requests
      ADD CONSTRAINT training_export_requests_status_check
      CHECK (status IN ('pending','approved','rejected','downloaded','expired'));
    ALTER TABLE training_export_requests
      ADD CONSTRAINT training_export_requests_format_check
      CHECK (format IN ('alpaca','chatml'));
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE training_export_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_training_export_requests_tenant ON training_export_requests
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_training_export_requests_tenant ON training_export_requests');
  await knex.schema.dropTableIfExists('training_export_requests');
}
