import { Knex } from 'knex';

/**
 * Audit Tier 5.1 — AI kill switch + 2-person approval on AI disable.
 *
 * Two parallel concerns:
 *
 * 1. Seed the four core AI feature flags as GLOBAL rows so every AI
 *    route has a concrete flag to check. Default enabled=true so the
 *    v1.2.0 rollout is opt-out, not opt-in. Per-clinic override rows
 *    can be inserted later via the feature-flag admin UI.
 *
 *       ai-scribe     — scribe pipeline (ambient + whisper + Pass 1/2/3)
 *       ai-letter     — letter drafting (referral, patient summary)
 *       ai-chat       — AI Chat / suggestion endpoint
 *       ai-training   — training export + local adapter training
 *
 * 2. Add `feature_flag_disable_requests` to support the two-person
 *    approval flow when a clinic admin wants to disable any `ai-*`
 *    flag. A requester opens a row in status='pending'; a second
 *    admin (different staff_id) approves or rejects it. Only on
 *    approval does the flag flip to disabled + the row updates to
 *    status='approved'. Same pattern as break-glass dual approval.
 *
 * Schema:
 *   - id uuid PK
 *   - clinic_id uuid FK clinics (NULL for global flag requests)
 *   - flag_name text  (e.g. 'ai-scribe')
 *   - action enum ('disable')  — approval on enable is not required
 *     because enabling is the safe default; only disabling is gated.
 *   - requested_by_id uuid FK staff
 *   - requested_at timestamptz DEFAULT now
 *   - approved_by_id uuid FK staff NULLABLE
 *   - approved_at timestamptz NULLABLE
 *   - status enum ('pending','approved','rejected','expired')
 *   - reason text NULLABLE  — requester's justification
 *   - rejection_reason text NULLABLE
 *   - created_at timestamptz
 *
 * Indexes: (clinic_id, status) for pending-list UI.
 *
 * RLS: per-clinic + global rows for platform-owner admins. Same
 * predicate pattern as ai_model_approvals.
 *
 * Append-only audit table per §G6 — no updated_at trigger.
 * Corrections create a new pending request; history is preserved.
 *
 * Reversible: down() drops the table + policy + flag seeds.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('feature_flag_disable_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id')
      .nullable()
      .references('id').inTable('clinics').onDelete('CASCADE');
    t.string('flag_name', 100).notNullable();
    t.string('action', 20).notNullable().defaultTo('disable');
    t.uuid('requested_by_id')
      .notNullable()
      .references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('requested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('approved_by_id')
      .nullable()
      .references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('approved_at', { useTz: true }).nullable();
    t.string('status', 20).notNullable().defaultTo('pending');
    t.text('reason').nullable();
    t.text('rejection_reason').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // §7.1 — every FK column + the pending-list lookup.
    t.index(['clinic_id']);
    t.index(['requested_by_id']);
    t.index(['approved_by_id']);
    t.index(['clinic_id', 'status'], 'idx_ffd_requests_clinic_status');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE feature_flag_disable_requests
      ADD CONSTRAINT ffd_requests_action_check CHECK (action IN ('disable'));
    ALTER TABLE feature_flag_disable_requests
      ADD CONSTRAINT ffd_requests_status_check
      CHECK (status IN ('pending','approved','rejected','expired'));
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE feature_flag_disable_requests ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ffd_requests_tenant ON feature_flag_disable_requests
      FOR ALL
      USING (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      )
      WITH CHECK (
        clinic_id IS NULL
        OR clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid
      );
  `);

  // Seed the four global AI flags. Idempotent via WHERE NOT EXISTS —
  // existing rows are left untouched so a re-run is safe.
  const flagSeeds = [
    { name: 'ai-scribe', description: 'Ambient scribe pipeline + Whisper + Pass 1/2/3 LLM' },
    { name: 'ai-letter', description: 'Letter drafting (referral, patient summary, after-visit)' },
    { name: 'ai-chat',   description: 'AI Chat / suggestion endpoint' },
    { name: 'ai-training', description: 'Training export + local adapter training' },
  ];
  for (const { name, description } of flagSeeds) {
    // @migration-raw-exempt: data_backfill_insert
    await knex.raw(
      `INSERT INTO feature_flags (clinic_id, name, description, enabled, rollout_percentage)
       SELECT NULL, ?, ?, true, 100
       WHERE NOT EXISTS (
         SELECT 1 FROM feature_flags WHERE clinic_id IS NULL AND name = ?
       )`,
      [name, description, name],
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  // Clear the seeds only if they still match the migration-inserted defaults
  for (const name of ['ai-scribe', 'ai-letter', 'ai-chat', 'ai-training']) {
    await knex('feature_flags').whereNull('clinic_id').where({ name }).delete();
  }
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_ffd_requests_tenant ON feature_flag_disable_requests');
  await knex.schema.dropTableIfExists('feature_flag_disable_requests');
}
