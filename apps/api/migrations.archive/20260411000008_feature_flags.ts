import type { Knex } from 'knex';

/**
 * S4.2 — Feature flags
 *
 * Lightweight in-house feature toggle system. The plan called for
 * self-hosted Unleash but that's a 1-container infra dependency we
 * can't provision from a code-only commit. This table + the
 * featureFlags module ship the same surface area (name-based
 * boolean lookup with per-tenant overrides) so a future Unleash
 * migration is a backend-of-the-flag-service swap, not a rewrite of
 * every call site.
 *
 * Schema:
 *   - One row per (clinic_id, name). clinic_id NULL means GLOBAL
 *     default (applies to every clinic that doesn't have its own
 *     row). The lookup query is "WHERE name = ? AND (clinic_id = ?
 *     OR clinic_id IS NULL) ORDER BY clinic_id NULLS LAST LIMIT 1"
 *     so a clinic-specific row overrides the global one.
 *   - enabled is a plain boolean. Future Unleash migration can map
 *     to its activation strategies (gradualRollout, userIDs, etc.)
 *   - rollout_percentage 0-100 lets us do a simple modulo-on-userid
 *     gradual rollout without depending on Unleash. Default 100.
 *   - description is for the admin UI; never used at runtime.
 *
 * RLS-safe: clinic_id is the partition key. Global rows (clinic_id
 * NULL) are readable by any tenant. Per-tenant rows are only
 * readable by their owning tenant — the service layer enforces this.
 *
 * Append-only with hasTable guards. Down is a no-op.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('feature_flags'))) {
    await knex.schema.createTable('feature_flags', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      // null = global default
      t.uuid('clinic_id').nullable();
      // canonical name, e.g. 'scribe-live-transcript', 'rag-context'
      t.string('name', 100).notNullable();
      t.text('description').nullable();
      t.boolean('enabled').notNullable().defaultTo(false);
      // 0-100. Defaults to 100 = "fully on when enabled". Lets a
      // clinic dial in a partial rollout to a fraction of staff IDs
      // hashed against the flag name.
      t.integer('rollout_percentage').notNullable().defaultTo(100);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      // Partial unique: one (clinic_id, name) per non-null clinic, AND
      // one global row per name. Enforced via two indexes.
      t.index(['name']);
      t.index(['clinic_id', 'name']);
    });

    // Force at most one global row per name
    await knex.raw(
      `CREATE UNIQUE INDEX feature_flags_name_global_idx
       ON feature_flags(name) WHERE clinic_id IS NULL`,
    );
    // Force at most one row per (clinic_id, name) for non-global rows
    await knex.raw(
      `CREATE UNIQUE INDEX feature_flags_name_clinic_idx
       ON feature_flags(clinic_id, name) WHERE clinic_id IS NOT NULL`,
    );
  }
}

export async function down(): Promise<void> {
  // No-op. Feature flag rows may carry rollout state we don't want
  // to lose on accidental rollback.
}
