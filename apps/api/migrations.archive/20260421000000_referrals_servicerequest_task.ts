/**
 * Phase 1 of the multi-specialty expansion — referral ServiceRequest + Task split.
 *
 * Adds a typed target specialty and the FHIR-aligned two-status model to
 * the existing `referrals` table:
 *
 *   - target_specialty_code   — which specialty the referral is destined for.
 *                               FK to specialties.code, defaults to
 *                               mental_health so legacy rows remain routable.
 *   - service_request_status  — FHIR ServiceRequest.status — whether the
 *                               REQUEST (the clinical intent) is still
 *                               active. Independent of triage state.
 *   - task_status             — FHIR Task.status — where the coordinator's
 *                               work on the request has reached.
 *   - coordinator_id          — staff who currently owns the triage task.
 *   - triaged_at / triaged_by — audit when and by whom the task was
 *                               advanced past the requested state.
 *
 * Also creates the `referral_state_transitions` audit table so every move
 * in the task state machine is recorded. Each row is clinic-scoped with
 * full RLS.
 *
 * Backfill is conservative:
 *   - All legacy referrals get target_specialty_code='mental_health'
 *     (safe default; the backfill script can re-tag heuristically).
 *   - service_request_status='active' for all legacy rows.
 *   - task_status='received' so they're visible in the coordinator queue
 *     but not flagged as fresh/triaged.
 */
import type { Knex } from 'knex';

const SR_STATUSES = ['draft', 'active', 'revoked', 'completed'] as const;
const TASK_STATUSES = [
  'requested',
  'received',
  'accepted',
  'rejected',
  'in_progress',
  'completed',
] as const;

const SR_CHECK = SR_STATUSES.map((s) => `'${s}'`).join(', ');
const TASK_CHECK = TASK_STATUSES.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  // ── 1. referrals column additions ──
  const hasTargetSpecialty = await knex.schema.hasColumn('referrals', 'target_specialty_code');
  const hasSrStatus = await knex.schema.hasColumn('referrals', 'service_request_status');
  const hasTaskStatus = await knex.schema.hasColumn('referrals', 'task_status');
  const hasCoordinator = await knex.schema.hasColumn('referrals', 'coordinator_id');
  const hasTriagedAt = await knex.schema.hasColumn('referrals', 'triaged_at');
  const hasTriagedBy = await knex.schema.hasColumn('referrals', 'triaged_by');

  if (!hasTargetSpecialty || !hasSrStatus || !hasTaskStatus || !hasCoordinator || !hasTriagedAt || !hasTriagedBy) {
    await knex.schema.alterTable('referrals', (t) => {
      if (!hasTargetSpecialty) t.string('target_specialty_code', 40).nullable();
      if (!hasSrStatus) t.string('service_request_status', 20).nullable();
      if (!hasTaskStatus) t.string('task_status', 20).nullable();
      if (!hasCoordinator) {
        t.uuid('coordinator_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      }
      if (!hasTriagedAt) t.timestamp('triaged_at', { useTz: true }).nullable();
      if (!hasTriagedBy) {
        t.uuid('triaged_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      }
    });
  }

  if (!hasTargetSpecialty) {
    // Backfill legacy rows to mental_health.
    await knex('referrals').whereNull('target_specialty_code').update({ target_specialty_code: 'mental_health' });

    // @migration-raw-exempt: legacy ALTER COLUMN SET NOT NULL; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE referrals ALTER COLUMN target_specialty_code SET NOT NULL`);
    // @migration-raw-exempt: legacy ALTER COLUMN SET DEFAULT; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE referrals ALTER COLUMN target_specialty_code SET DEFAULT 'mental_health'`);
    await knex.raw(`
      ALTER TABLE referrals
        ADD CONSTRAINT referrals_target_specialty_code_fkey
        FOREIGN KEY (target_specialty_code) REFERENCES specialties (code)
        ON UPDATE CASCADE ON DELETE RESTRICT
    `);
    // Coordinator queue: one index per (clinic, specialty, task_status).
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS referrals_coordinator_queue_idx
        ON referrals (clinic_id, target_specialty_code, task_status)
        WHERE deleted_at IS NULL`
    );
  }

  if (!hasSrStatus) {
    await knex('referrals').whereNull('service_request_status').update({ service_request_status: 'active' });
    // @migration-raw-exempt: legacy ALTER COLUMN SET NOT NULL; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE referrals ALTER COLUMN service_request_status SET NOT NULL`);
    // @migration-raw-exempt: legacy ALTER COLUMN SET DEFAULT; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE referrals ALTER COLUMN service_request_status SET DEFAULT 'active'`);
    await knex.raw(
      `ALTER TABLE referrals
        ADD CONSTRAINT referrals_service_request_status_check
        CHECK (service_request_status IN (${SR_CHECK}))`
    );
  }

  if (!hasTaskStatus) {
    // Legacy rows are backfilled to 'received' — they've been seen by
    // someone, but their triage history is unknown. The auto-degrade
    // rule fires for new referrals so this only affects the existing set.
    await knex('referrals').whereNull('task_status').update({ task_status: 'received' });
    // @migration-raw-exempt: legacy ALTER COLUMN SET NOT NULL; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE referrals ALTER COLUMN task_status SET NOT NULL`);
    // @migration-raw-exempt: legacy ALTER COLUMN SET DEFAULT; builder-equivalent pending R2 consolidation
    await knex.raw(`ALTER TABLE referrals ALTER COLUMN task_status SET DEFAULT 'requested'`);
    await knex.raw(
      `ALTER TABLE referrals
        ADD CONSTRAINT referrals_task_status_check
        CHECK (task_status IN (${TASK_CHECK}))`
    );
  }

  // ── 2. referral_state_transitions audit table ──
  if (!(await knex.schema.hasTable('referral_state_transitions'))) {
    await knex.schema.createTable('referral_state_transitions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('referral_id').notNullable().references('id').inTable('referrals').onDelete('CASCADE');
      t.string('from_task_status', 20).nullable();
      t.string('to_task_status', 20).notNullable();
      t.uuid('actor_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('reason').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
      t.index(['referral_id']);
      t.index(['clinic_id', 'referral_id', 'created_at']);
    });

    await knex.raw(`
      ALTER TABLE referral_state_transitions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_referral_state_transitions_tenant ON referral_state_transitions
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('referral_state_transitions');

  await knex.raw(`DROP INDEX IF EXISTS referrals_coordinator_queue_idx`);
  await knex.raw(`ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_task_status_check`);
  await knex.raw(`ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_service_request_status_check`);
  await knex.raw(`ALTER TABLE referrals DROP CONSTRAINT IF EXISTS referrals_target_specialty_code_fkey`);

  const cols = [
    'triaged_by',
    'triaged_at',
    'coordinator_id',
    'task_status',
    'service_request_status',
    'target_specialty_code',
  ];
  for (const col of cols) {
    const has = await knex.schema.hasColumn('referrals', col);
    if (has) {
      await knex.schema.alterTable('referrals', (t) => t.dropColumn(col));
    }
  }
}
